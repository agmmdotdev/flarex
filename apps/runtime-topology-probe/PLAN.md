# Runtime Topology Probe Turn Plan

Status: experimental evidence plan; `P00` complete and `P01` through `P11`
approved for ordered execution.

This file owns a bounded production probe for measuring Cloudflare runtime
communication. It is local to `apps/runtime-topology-probe`; it is not an
active Flarex roadmap, does not promote the conditional `C07A` SessionDO/facet
path, and does not claim that the sync replacement is implemented.

## Goal

Build and run an isolated probe that measures these future-shaped boundaries:

```text
protected probe gateway Worker
  -> one ProbeSessionDO per top-level probe session
  -> one dynamically loaded ProbeInvocationFacet per attempt
       -> restricted mock-read call to a private MockCommitWorker
       -> temporary SQLite journal append/seal
  -> sealed mock journal/result returned to ProbeSessionDO
  -> private mock-finish call to MockCommitWorker
  -> mock post-commit wake from MockCommitWorker
  -> separately deployed private ProbeSync Worker
  -> one deterministic ProbeSyncDO per synthetic scope
  -> optional sync-triggered rerun through a fresh probe session/facet
```

The probe answers how much latency and variability each Cloudflare boundary
adds in production. It does not test Flarex transaction correctness.

## Design Boundary

### Included

- a separately deployable, token-protected probe gateway;
- a SQLite-backed `ProbeSessionDO` supervisor;
- a Worker Loader binding and a dynamically loaded Durable Object facet;
- a separate private `MockCommitWorker` reached through a service binding;
- a separate private ProbeSync Worker that owns only `ProbeSyncDO`;
- a SQLite-backed `ProbeSyncDO` that models only the communication shape of
  the accepted future `DeploymentSyncDO`;
- direct Dynamic Worker and SessionDO-only controls so facet overhead can be
  attributed instead of guessed;
- mock read, sealed-journal, mock finish, direct-wake, and optional rerun flows;
- locally measured hop durations and bounded production evidence collection;
- explicit facet/DO cleanup and cost-bounded cold-start sampling.

### Excluded

- Postgres, Hyperdrive, PGlite, schema migrations, real snapshots, OCC,
  idempotency, commit compilation, authoritative outcomes, and outbox recovery;
- production executor, artifact, deployment, sync, subscription, or connection
  state;
- real tenant code, credentials, source packages, or developer data;
- a real `DeploymentDO`, `DeploymentSyncDO`, or `ConnectionDO`;
- any conclusion that the probe alone selects or rejects `C07A`.

The private mock Worker deliberately preserves the executor-host network/runtime
hop while containing no executor logic. It must originate the synthetic
post-commit wake. The gateway, supervisor, and facet must never claim that a
commit occurred and must never wake `ProbeSyncDO` on the mock Worker's behalf.

`ProbeSyncDO` is intentionally not named `DeploymentDO`: the old deployment
actor is not the accepted future sync actor, and reusing that name would measure
and teach the wrong ownership boundary.

## Evidence And Challenge Record

The accepted design and current roadmaps impose these constraints:

- `design-notes/flarex-db-accepted-design.md` keeps the SessionDO/facet journal
  conditional after the Postgres-backed proof and assigns post-commit waking to
  the trusted executor-host boundary.
- `roadmaps/06-dynamic-worker-execution.md` requires a prototype to compare a
  custom-binding-only control with the supervisor/facet shape, pin the code and
  attempt identities, avoid reentrant facet-to-supervisor callbacks, and cover
  lifecycle/cleanup behavior.
- `roadmaps/21-cloudflare-freshness-cache.md` says the accepted per-scope
  `DeploymentSyncDO` replacement is not implemented and that a direct wake is a
  latency hint, not recovery authority.
- `roadmaps/35-commit-compiler-and-session-intent.md` requires the real `C07A`
  decision to compare against Postgres-backed journal persistence. Because this
  probe omits Postgres, it can characterize topology overhead but cannot serve
  as that decision receipt.

Cloudflare's current documentation says Durable Object facets are dynamic
classes supervised by a normal SQLite-backed Durable Object, each facet has
isolated SQLite, `facets.get()` may run its startup callback when a facet starts
or resumes after hibernation, and `facets.delete()` removes its storage:

- <https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/>

Service bindings and Dynamic Worker identifiers affect both the topology and
the experiment budget:

- <https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/>
- <https://developers.cloudflare.com/dynamic-workers/pricing/>

These external assumptions must be rechecked immediately before the production
deployment gate.

## Probe Shapes

Every shape uses the same versioned request and result envelope so measurements
can be compared without changing the harness.

| ID | Shape | Purpose |
| --- | --- | --- |
| `edge_echo` | client -> gateway | Establish external and harness baseline. |
| `session_echo` | gateway -> ProbeSessionDO -> gateway | Isolate Durable Object routing/activation. |
| `dynamic_direct_echo` | gateway -> direct Dynamic Worker -> gateway | Establish the custom-binding-only Dynamic Worker control. |
| `facet_echo` | gateway -> ProbeSessionDO -> facet -> gateway | Measure supervisor/facet routing without journal I/O. |
| `facet_journal` | previous shape plus facet SQLite append/seal | Measure temporary journal cost by entry count and payload size. |
| `commit_wake` | MockCommitWorker -> ProbeSyncDO | Measure the post-commit direct-wake hint and sync cursor write. |
| `full_invoke` | session -> facet -> mock read/finish -> sync wake | Measure the joined invocation-to-sync path. |
| `sync_rerun` | ProbeSyncDO -> fresh runtime session/facet -> ProbeSyncDO | Measure the reverse rerun loop without reentering an awaited session. |

The direct control does not pretend to be the later Postgres-journal baseline.
It answers only how much of the measured latency comes from Dynamic Worker
loading/calls versus the supervisor/facet layer.

## Measurement Contract

Each caller measures its own complete round trip with a monotonic local clock.
The harness must not subtract absolute timestamps produced by different
isolates to claim one-way latency. Nested responses return locally measured
durations in a versioned trace tree.

Production Worker clocks advance only around I/O. Runtime spans therefore
measure awaited Durable Object, facet, service-binding, or storage-sync round
trips; they do not claim CPU-only serialization or digest time. The external
collector owns complete client wall-clock latency. Facet journal timing includes
an explicit storage synchronization boundary.

Each sample records at least:

- run ID, sample ID, scenario ID, protocol version, and outcome;
- locally measured duration for every completed hop;
- payload bytes, journal entry count, concurrency, session/facet IDs, and code
  ID mode;
- stable-code, new-session, new-attempt, or bounded-new-code test mode;
- whether the facet startup callback ran as a startup/rehydration hint;
- the gateway request's Cloudflare colo metadata when available; and
- normalized errors and missing-span evidence without secrets or payload data.

Reports include count, success/failure rate, minimum, median, p95, p99, and
maximum per scenario and hop. Console or remote logging must not occur inside a
timed interval. Cloudflare traces may corroborate a run, but application-local
round trips are the comparison authority.

The production sample matrix and run limits are frozen before deployment. Warm
samples use a stable Worker Loader ID. New-code samples use a small bounded set
of unique IDs because changing an ID or code version changes Dynamic Worker
creation and billing.

## Safety And Operability Rules

- Use dedicated probe Worker names, Durable Object namespaces, secrets, and
  synthetic identifiers. Never bind the probe to production Flarex resources.
- Fail closed without a probe bearer token. Keep the mock Worker private behind
  service bindings.
- Bound repetitions, concurrency, payload bytes, journal entries, facets per
  session, and unique Dynamic Worker code IDs at the server boundary.
- Gates `P02` through `P06` are local and dry-run-only. Production deployment
  remains blocked until `P07` freezes a server-owned run record, atomically
  claims its sample ordinals, enforces its total budget, and records observed
  orchestration concurrency instead of trusting caller-declared cohort labels.
- Set `globalOutbound: null` for loaded code. Pass only the narrow mock syscall
  capability required by the selected scenario.
- A facet must never call back into the same supervisor while that supervisor
  awaits the facet. The optional rerun creates a fresh session/attempt path.
- Keep the deployed dependency graph acyclic: gateway -> mock commit -> sync.
  A sync-triggered rerun uses a per-call forwarded capability and never a
  permanent sync-to-gateway service binding.
- Use a distinct facet identity per attempt. Delete the facet after the sample
  unless a named lifecycle scenario requires preserved storage.
- Provide explicit purge/teardown operations for synthetic DO state and retain
  no tenant information.
- Local emulation proves protocol and cleanup behavior only. Production numbers
  require an explicitly approved Cloudflare deployment and bounded run.

## Turn-By-Turn Gates

A turn implements only the current ordered gate. The app-local `AGENTS.md`
records the user's approval for the complete isolated experiment: the main
thread still performs the repository-grounded preflight and challenge for each
behavior-changing gate, but does not pause for repeated approval while scope
and external targets remain inside this plan.

### P00 - Create The Experiment Record And Root

Status: complete.

Deliver:

- create `apps/runtime-topology-probe/`;
- add this app-local plan;
- record boundaries, controls, measurement rules, safety rules, and ordered
  gates without changing an active roadmap.

Proof:

- the diff contains only the new experiment plan;
- existing unrelated working-tree changes remain untouched;
- Markdown paths and source links are checked;
- commit the preparation checkpoint.

Exit: present the P01 preflight. Do not create deployable code in P00.

### P01 - Scaffold The Offline Package And Freeze Protocol V1

Status: complete.

Deliver:

- workspace package metadata, TypeScript/Vitest configuration, and app README;
- versioned probe request, trace-span, trace-result, error, and limit contracts;
- deterministic ID derivation helpers for run, synthetic scope, session, code,
  and attempt identities;
- pure aggregation helpers and unit tests for percentiles, failed samples, and
  incomplete trace trees.

Non-goals: Wrangler bindings, Durable Objects, Worker Loader, deployment, or
network calls.

Proof: package typecheck and focused unit tests.

### P02 - Add The Protected Gateway And SessionDO Echo

Status: complete.

Deliver:

- token-protected probe endpoint with server-side per-request shape and byte
  limits;
- SQLite-backed `ProbeSessionDO` and `edge_echo`/`session_echo` scenarios;
- local Miniflare coverage for authorization, identity isolation, limits,
  repeated samples, storage reset, and trace completeness;
- initial Wrangler configuration and Durable Object migration.

Non-goals: Dynamic Workers, facets, mock commit, sync wake, or production
deployment.

Proof: typecheck, focused tests, bundle/dry-run, and local smoke test with all
Wrangler/workerd processes stopped afterward.

### P03 - Add The Direct Dynamic Worker Control

Status: in progress and approved.

Deliver:

- static, platform-owned probe source loaded through Worker Loader;
- stable code-ID and bounded new-code-ID modes;
- `dynamic_direct_echo` with egress disabled and no privileged bindings;
- trace evidence distinguishing loader callback execution from ordinary calls.

Non-goals: facets, SQLite journaling, mock commit, sync, authoritative run
registration, aggregate budget enforcement, or external deployment.

Proof: focused loader/identity/limit tests plus local smoke and bundle/dry-run.

### P04 - Add The Session Facet And Temporary Journal

Status: approved; pending.

Deliver:

- one dynamically loaded `ProbeInvocationFacet` per attempt under
  `ProbeSessionDO`;
- `facet_echo` and `facet_journal` scenarios;
- bounded logical entries, deterministic sequence/digest, seal/readback, and
  facet deletion;
- lifecycle scenarios for reuse, abort-with-storage-preserved, delete, startup
  callback, and a fresh attempt identity;
- proof that supervisor code never opens facet SQLite and that the facet never
  reenters its awaiting supervisor.

Non-goals: a real session journal contract, compiler, OCC, or recovery claim.

Proof: typecheck, focused lifecycle/storage/limit tests, local smoke, and
bundle/dry-run.

### P05 - Add The Private Mock Commit And ProbeSyncDO Wake

Status: approved; pending.

Deliver:

- separately deployable private `MockCommitWorker` service-binding target;
- separately deployable private ProbeSync Worker owning `ProbeSyncDO`;
- restricted mock-read and mock-finish calls with deterministic synthetic
  commit summaries;
- deterministic per-synthetic-scope `ProbeSyncDO` with a tiny SQLite cursor and
  wake receipt;
- `commit_wake` and `full_invoke` scenarios;
- enforcement that only the mock commit boundary originates wake calls.

Non-goals: Postgres, OCC, commit compilation, durable outbox recovery, gaps,
canonical queries, or real sync behavior.

Proof: contract tests across all three Workers, duplicate/out-of-order
synthetic wake tests, local integration smoke, and gateway/mock/sync deployment
dry-runs.

### P06 - Add The Optional Sync-To-Runtime Rerun Loop

Status: approved; pending.

Deliver:

- `sync_rerun` through a private runtime entrypoint and a fresh session/attempt;
- a per-call forwarded rerun capability rather than a permanent reverse
  service binding;
- complete sync-to-runtime-to-sync trace correlation;
- bounded recursion/reentry protection and a terminal acknowledgement that
  performs no second commit wake.

Non-goals: canonical query registration, dependency indexing, result delivery,
WebSockets, or `ConnectionDO`.

Proof: focused no-cycle/no-reentry tests and local end-to-end smoke.

If Cloudflare's forwarded RPC capability cannot cross the complete local or
hosted call chain, record that unsupported result directly. Do not substitute
gateway polling because it would measure the opposite communication direction.

### P07 - Harden Lifecycle, Cleanup, And Evidence Collection

Status: approved; pending.

Deliver:

- authenticated run/status/purge endpoints;
- server-owned immutable run registration, atomic sample claims, duplicate and
  excess-sample rejection, aggregate request/code budgets, and observed
  concurrency labels;
- bounded concurrency and payload matrix;
- machine-readable evidence artifact with secrets and payloads excluded;
- facet deletion, DO storage purge, partial-run handling, and idempotent
  teardown;
- warm/new-session/new-attempt/bounded-new-code modes and explicit caveats for
  hibernation/cold-start hints.

Proof: limit abuse tests, cleanup/retry tests, full local matrix, typecheck,
tests, and deploy dry-runs.

### P08 - Production Deployment Preflight

Status: approved; pending.

This is a discussion/evidence gate before external state changes.

Deliver:

- reverify Cloudflare facet, Worker Loader, service binding, pricing, limits,
  observability, and migration documentation;
- list exact isolated Worker/DO names, account/environment target, secrets,
  commands, estimated request/unique-code budget, sample matrix, and teardown;
- freeze success criteria and the evidence destination;
- prove no binding points at production Flarex resources.

Exit: verify the existing approval still covers the named isolated deployment
and bounded run. Pause only if the account or resource target is ambiguous or
scope would expand.

### P09 - Deploy And Smoke The Isolated Probe

Status: approved; pending.

Deliver:

- deploy the private sync target first, the private mock target second, and the
  protected gateway last;
- verify authentication failure/success, every scenario once, trace
  completeness, observability, limits, and purge behavior;
- stop immediately on incorrect routing, unbounded creation, or unexpected
  billing/resource behavior.

Proof: a small production smoke receipt and a successful cleanup rehearsal.

### P10 - Collect Production Latency Evidence

Status: approved; pending.

Deliver:

- run only the frozen matrix and limits;
- collect machine-readable raw samples and a derived summary;
- separate client-to-edge latency from Cloudflare-internal hop durations;
- report median/p95/p99, failure rate, startup-callback cohort, payload effects,
  concurrency effects, and region/colo caveats.

Proof: complete, schema-valid evidence with sample counts matching the approved
budget and no secret or tenant data.

### P11 - Analyze, Record Conclusions, And Teardown

Status: approved; pending.

Deliver:

- explain which boundaries dominate and how much variance each shape adds;
- compare direct Dynamic Worker, SessionDO, and facet controls;
- state what the no-Postgres probe cannot prove;
- record whether a later real `C07A` comparison is worth running, without
  selecting the architecture prematurely;
- delete or intentionally retain the isolated deployment according to the P08
  approval, and verify cleanup.
- when deleting the experiment, purge known facets/objects, apply the required
  Durable Object deleted-class migrations, then delete gateway, mock, and sync
  scripts in dependency order and verify absence.

Exit: close the experiment goal only after evidence, conclusions, and requested
teardown are complete.

## Goal Loop State

- Active goal: build and validate the isolated production runtime-topology
  probe through separately approved gates.
- Current gate: `P03` implementation.
- Next gate after proof and checkpoint: `P04`.
- Goal completion condition: production evidence and analysis are recorded and
  the approved cleanup/retention action is verified.
