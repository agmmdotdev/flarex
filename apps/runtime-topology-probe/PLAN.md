# Runtime Topology Probe Turn Plan

Status: experiment complete; `P00` through `P15` passed. The approved
SessionDO-hosted executor extension completed its production A/B, rejected the
candidate on the frozen latency threshold, and removed every isolated resource.
The first production
attempt failed the Paid-eligibility gate and was cleaned up. After the owner
upgraded the same isolated target, P09 smoke and P10 evidence collection passed,
P11 recorded the bounded conclusions, and every isolated Cloudflare resource
was removed.

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
- <https://developers.cloudflare.com/workers/runtime-apis/context/>
- <https://developers.cloudflare.com/workers/runtime-apis/rpc/>
- <https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/>
- <https://developers.cloudflare.com/workers/configuration/compatibility-flags/>
- <https://developers.cloudflare.com/dynamic-workers/pricing/>

At the currently pinned `2026-06-14` compatibility date, `ctx.exports` is
available without an explicit compatibility flag. The installed runtime
rejects `enable_ctx_exports` because that behavior has been the default since
`2025-11-17`. This is an experiment input, not a permanent platform
assumption, and must be reverified at `P08`.

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

Every Dynamic Worker ID includes a runtime profile and source/configuration
version. Direct, facet-only, and privileged mock-invoke Workers must never
reuse an ID because their source and injected capabilities differ. A source,
compatibility date, limit, or binding-contract change requires a new profile
version before the production matrix is registered.

## Safety And Operability Rules

- Use dedicated probe Worker names, Durable Object namespaces, secrets, and
  synthetic identifiers. Never bind the probe to production Flarex resources.
- Fail closed without a probe bearer token. Keep the mock Worker private behind
  service bindings.
- Bound repetitions, concurrency, payload bytes, journal entries, facets per
  session, and unique Dynamic Worker code IDs at the server boundary.
- Gates `P02` through `P07B` were local and dry-run-only. `P07B` closed the
  local bounded-orchestration, evidence, reconciliation, and resumable-purge
  gates; production deployment required the separate `P08` preflight. P09 and
  P10 later ran only the frozen production matrix, and P11 removed the isolated
  deployment.
  `P07A` budgets only one immutable run/cell; the fixed `P07B` coordinator owns
  the deployment-wide creation limit for this isolated probe.
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

A turn implements only the current ordered gate. Repository agent rules own
the required preflight, review, validation, approval, and commit cadence. A
completed gate does not authorize implementation of the next gate.

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

Status: complete.

Deliver:

- static, platform-owned probe source loaded through Worker Loader;
- stable code-ID and bounded new-code-ID modes;
- `dynamic_direct_echo` with egress disabled and no privileged bindings;
- trace evidence distinguishing loader callback execution from ordinary calls.

Non-goals: facets, SQLite journaling, mock commit, sync, authoritative run
registration, aggregate budget enforcement, or external deployment.

Proof: focused loader/identity/limit tests plus local smoke and bundle/dry-run.

### P04 - Add The Session Facet And Temporary Journal

Status: complete.

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

Status: complete.

Deliver:

- separately deployable private `MockCommitWorker` service-binding target;
- separately deployable private ProbeSync Worker owning `ProbeSyncDO`;
- restricted mock-read and mock-finish calls with deterministic synthetic
  commit summaries;
- deterministic per-synthetic-scope `ProbeSyncDO` with a tiny SQLite cursor and
  wake receipt;
- `commit_wake` and `full_invoke` scenarios;
- enforcement that only the mock commit boundary originates wake calls.

Non-goals: Postgres, OCC, commit compilation, durable outbox recovery, gap
recovery/backfill, canonical queries, or real sync behavior.

Proof: contract tests across all three Workers, duplicate/out-of-order
synthetic wake tests, local integration smoke, and gateway/mock/sync deployment
dry-runs.

### P06 - Add The Optional Sync-To-Runtime Rerun Loop

Status: complete.

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

Implemented communication shape:

```text
gateway
  -> MockRerunEntrypoint
  -> ProbeSyncDO
  -> per-call forwarded one-shot RpcTarget
  -> gateway-local ProbeRuntimeRerunEntrypoint via ctx.exports
  -> fresh ProbeSessionDO path
  -> rerun-v1 attempt facet
  -> terminal return value to ProbeSyncDO
```

The permanent deployed graph remains `gateway -> mock -> sync`; there is no
sync-to-gateway service binding. The forwarded target pins the depth-1 runtime
request, exposes only `invoke()`, rejects concurrent or repeated use, is
awaited exactly once, and is neither retained nor persisted. The terminal
acknowledgement is the return value from that call and cannot originate a
second wake. The rerun facet has no bindings, outbound networking, or
subrequests, and the synthetic sync cursor is observed before and after but is
not mutated.

Local integration proves normal-path facet deletion by replaying the same
synthetic identity and observing a new facet-startup callback. It does not
prove crash-durable cleanup: an isolate termination between facet creation and
deletion could leave tracked state. Nor does P06 atomically claim its
deterministic sample/session/attempt identity. Those limitations keep this a
latency-topology experiment. `P07A` adds sample claims and per-cell budgets;
`P07B` adds reconciliation, verified evidence persistence, and idempotent purge
before any production deployment can be considered.

If Cloudflare's forwarded RPC capability cannot cross the complete local or
hosted call chain, record that unsupported result directly. Do not substitute
gateway polling because it would measure the opposite communication direction.

### P07A - Add Per-Cell Run Control And Measurement Integrity

Status: complete. It was proven locally at this gate, later exercised only by
the isolated P09-P10 deployment, and removed in P11.

Delivered:

- one gateway-owned SQLite `ProbeRunDO` per immutable run ID, where a run is
  exactly one scenario/dimension matrix cell;
- authenticated create/status/sample routes and a compact public sample command
  containing only protocol version, run ID, and sample ordinal;
- server-loaded registration plus derived warmup phase, synthetic payload,
  identities, and per-cell request/payload/journal/unique-code budgets;
- atomic claim/finalize transitions, opaque claim-token fencing, exact
  idempotent finalization, duplicate/excess rejection, and no claim reopening;
- durable claimed/completed/failed sample state and raw controlled fragments;
- maximum outstanding claim-lifetime observations per sample and per run,
  kept separate from configured concurrency and explicitly not described as
  exact simultaneous scenario CPU or I/O;
- a gateway-local scenario-window duration outside the existing topology spans;
  caller-measured `external_request` explicitly includes authentication,
  parsing, claim, scenario execution, finalization, and response transfer;
- explicit eligible, warmup-excluded, and duplicate-wake-excluded dispositions,
  with applied/duplicate/gap/stale sync observations retained; and
- sequential ordinal claims for `commit_wake` and `full_invoke`, whose synthetic
  cursor protocol cannot safely classify reordered completion as ordinary
  latency evidence.

A crash after claim never makes JavaScript resumable and never reopens the
ordinal. Status leaves that sample visibly claimed until the later
reconciliation gate. A RunDO caps only its own cell; unlimited distinct run IDs
remain a cross-run production-budget risk.

Non-goals: purge, abandoned-run reconciliation, a local matrix runner,
machine-readable evidence export, deployment, Postgres, OCC, executor logic,
or production sync semantics.

Proof: strict protocol tests; same-ordinal races; aggregate-budget accounting;
claim-token and idempotent-finalize tests; observed-concurrency tests; restart
persistence with an abandoned claim; public auth/registration/status tests;
duplicate-wake cohort separation; P02-P06 regression tests; typecheck; local
Miniflare; and all deployment dry-runs.

### P07B - Add Reconciliation, Purge, Runner, And Evidence Export

Status: complete. It was proven locally at this gate, later exercised only by
the isolated P09-P10 deployment, and removed in P11.

#### Approved implementation preflight

What: add one fixed-identity, gateway-owned `ProbeCampaignDO` for this isolated
deployment. It freezes one immutable matrix before creating any RunDO, derives
the exact cross-run sample-execution and distinct-code-ID budgets, coordinates
run registration/reconciliation/evidence sealing, and retains a resumable purge
journal. Extend RunDO with sealed/reconciled state, explicit abandoned claims,
caller-duration completion, safe paged evidence, and storage purge. Extend
SessionDO and ProbeSyncDO with identity-fenced purge operations, with sync purge
still routed through the private mock Worker. Add a host-neutral runner, a
checked-in bounded local matrix, strict raw/summary artifact schemas, and a
bounded abortable deadline plus pre-decode response ceiling for every runner
request.

Why now: P07A prevents duplicate execution inside one run but deliberately
leaves unlimited run IDs, lost caller durations, abandoned claims, and crash
cleanup unresolved. Those are the remaining local blockers before an external
deployment can be safely named and costed at P08.

Authority and evidence: this app-local plan owns the experiment order. Current
`gateway.ts`, `probeRunDO.ts`, `sessionDO.ts`, `probeSyncDO.ts`, and their
Miniflare tests provide the implementation baseline. Cloudflare's facet API
requires explicit facet deletion, while SQLite `deleteAll()` clears only the
owning Durable Object's private storage. The accepted Flarex design remains
unchanged: this coordinator and all SQLite state are synthetic, isolated, and
non-authoritative.

What was challenged:

- The budget is deployment-wide for this one fixed coordinator, not literally
  Cloudflare-account-wide across arbitrary scripts. P08 must verify that this is
  the sole isolated probe deployment before using broader language.
- A caller-selected coordinator identity or direct RunDO registration would
  recreate the unlimited-creation hole, so the public identifier never selects
  the coordinator object.
- The coordinator stays off the timed sample path. Its immutable manifest plus
  each RunDO's one-claim-per-ordinal fence already bound actual scenario
  executions; an extra singleton authorization hop would distort concurrency
  and external latency without strengthening that execution bound.
- Reconciliation seals runs first, never reopens an ordinal, and records a lost
  call as `abandoned` without a fabricated result or duration. A late finalize
  races atomically with reconciliation and loses if abandonment commits first.
- Caller-local external duration is durably acknowledged only after the full
  response body is read. A terminal server fragment without that acknowledgement
  is exported as `external-duration-missing`, never estimated or replayed.
- Purge deletes manifest-derived and durably tracked facets before compacting
  SessionDO SQLite to one exact completion/fence tombstone, then clears sync
  storage through mock -> sync and clears RunDO storage last. Exact campaign,
  SessionDO, and SyncDO completion/fence tombstones remain until P11 so cleanup
  is resumable and the deployment cannot silently accept a second campaign,
  reopen a purged session, or process a late synthetic sync wake.
- SessionDO deliberately uses one physical child-deletion authority
  (`facets.delete`) and a transactional supervisor-row wipe. The pinned local
  workerd recursively deletes facet files again when parent `deleteAll()` runs;
  that double deletion fails before Cloudflare's
  [idempotency fix](https://github.com/cloudflare/workerd/commit/e7e3c6ac8c988b4620e9f65f9ece9ee1c917b1d7).
  Therefore the receipt means all probe data was cleared except the named
  tombstone, not that the SessionDO identity or SQLite file was deallocated.
  Worker Loader exposes no code-cache deletion operation, and P11 owns final
  deployment/namespace teardown.

Existing paths are classified as follows: keep the eight measured topology
shapes and one-way binding graph; port direct run registration behind the fixed
campaign manifest; extend RunDO, SessionDO, and ProbeSyncDO state machines;
rewrite the local collector around durable external-completion acknowledgement;
delete no production or legacy Flarex path; add no compatibility bridge because
the probe has no shipped contract or authoritative data.

Completion proof: strict manifest/budget tests, registration races and restart,
seal/reconcile/finalize races, caller-completion idempotency, redacted paged
evidence, interrupted and resumed purge in the required order, a full local
12-cell/eight-scenario matrix with exact counts, schema-valid raw and derived
artifacts, a stalled-transport deadline/abort proof, package typecheck and tests,
all three Wrangler dry-runs, and both required project reviewers. No active
architecture roadmap is changed and no external resource is deployed in P07B.

Deliver:

- bounded local orchestration for the frozen cross-run scenario/dimension
  matrix and its deployment-wide request/unique-code budget;
- partial-run inspection and explicit abandoned-claim reconciliation without
  pretending to resume a lost JavaScript call stack;
- resumable, idempotent facet and Durable Object storage purge;
- machine-readable raw evidence and derived summary artifacts with secrets,
  claim tokens, and payloads excluded;
- external-duration completion through the controlled collector contract; and
- the final local matrix/cleanup rehearsal required before production preflight.

Non-goals: deployment, Postgres, OCC, executor logic, or real sync behavior.

Proof: reconciliation and retry tests, interrupted/resumed purge tests, full
local matrix, schema-valid export, typecheck, tests, and deployment dry-runs.

### P08 - Production Deployment Preflight

Status: complete. The first authenticated attempt proved the target ineligible
and was cleaned up. The owner later upgraded it, and P09 directly proved the
new eligibility when Cloudflare accepted the Worker Loader deployment.

This is a discussion/evidence gate before external state changes.

The frozen target, budget, commands, corrected smoke/measurement sequence, and
teardown are recorded in `P08-PRODUCTION-PREFLIGHT.md`. Authentication,
workers.dev subdomain, resource ownership, and the USD 2 incremental-cost
ceiling were proven. The first gateway upload returned Cloudflare code `10195`:
the account's Standard default usage-model setting did not prove a Workers Paid
subscription. That former blocker is closed: the owner changed the subscription
outside the probe, and the experiment itself did not purchase or alter a plan.
The future P11 namespace-removal configs and Worker-deletion commands are
checked in and locally dry-run validated; they do not authorize or perform an
external deletion.

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

Status: complete. Attempt 1 stopped before gateway creation and was cleaned up.
Attempt 2 passed all eight production scenarios and left the campaign running
for the same-campaign P10 resume; P10 later sealed and purged it.

The failed-attempt absence proof is recorded in
`P09-PRODUCTION-ATTEMPT-1.md`; the successful smoke, latency, usage, trace
configuration, and retained-state receipt is in `P09-PRODUCTION-SMOKE.md`.

Deliver:

- deploy the private sync target first, the private mock target second, and the
  protected gateway last;
- verify authentication failure/success, one ordinal from every scenario,
  trace completeness, observability, limits, resumability, and the explicit
  abort path;
- leave the single immutable campaign running after a successful smoke so P10
  can execute its remaining ordinals; production purge occurs once after P10;
- stop immediately on incorrect routing, unbounded creation, or unexpected
  billing/resource behavior.

Proof: a small production smoke receipt plus a durable checkpoint that P10 can
resume. P07B remains the successful pre-production cleanup rehearsal.

### P10 - Collect Production Latency Evidence

Status: complete. The same P09 campaign produced 32 complete samples, 24
eligible measurements, schema-valid and digest-matched raw/summary artifacts,
zero scenario failures, and a terminal application purge. The sanitized receipt
is [`P10-PRODUCTION-EVIDENCE.md`](./P10-PRODUCTION-EVIDENCE.md).

Deliver:

- run only the frozen matrix and limits;
- resume the exact campaign and checkpoint created by P09 rather than creating
  a second campaign or deployment;
- collect machine-readable raw samples and a derived summary;
- separate client-to-edge latency from Cloudflare-internal hop durations;
- report median/p95/p99, failure rate, startup-callback cohort, payload effects,
  concurrency effects, and region/colo caveats.
- persist verified evidence before performing the campaign's single production
  application purge.

Proof: complete, schema-valid evidence with sample counts matching the approved
budget and no secret or tenant data.

### P11 - Analyze, Record Conclusions, And Teardown

Status: complete. The bounded conclusions and final absence proof are in
[`P11-CONCLUSIONS-AND-TEARDOWN.md`](./P11-CONCLUSIONS-AND-TEARDOWN.md).

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

### P12 - SessionDO-Hosted Mock Executor A/B Preflight

Status: complete. The approved boundary and frozen matrix are recorded.

The new experiment is recorded in
[`P12-SESSION-EXECUTOR-AB-PREFLIGHT.md`](./P12-SESSION-EXECUTOR-AB-PREFLIGHT.md).
It keeps the previous external mock executor path as a matched control and adds
one SessionDO-hosted synthetic read/finish candidate. It does not change an
active Flarex architecture roadmap or claim a real Postgres executor proof.

### P13 - Implement And Prove The Paired Paths Locally

Status: complete. The exact candidate/control paths, attempt and cleanup state
machines, 230-test local proof, bundle dry-runs, and clean mandatory reviews
are recorded in
[`P13-LOCAL-SESSION-EXECUTOR-PROOF.md`](./P13-LOCAL-SESSION-EXECUTOR-PROOF.md).

Deliver exact attempt-scoped capabilities, an explicit SessionDO attempt state
machine, matched control/candidate trace trees, strict protocol relationships,
interleaving and replay tests, full local matrix evidence, typecheck, bundle
dry-runs, and both required project reviews.

### P14 - Run The Bounded Production A/B

Status: complete. The same immutable campaign produced 28 complete samples,
24 eligible matched measurements, zero correctness exclusions, a publishable
evidence seal, terminal application purge, and the sanitized receipt in
[`P14-PRODUCTION-SESSION-EXECUTOR-AB.md`](./P14-PRODUCTION-SESSION-EXECUTOR-AB.md).

Deploy only the isolated probe resources, run the predeclared paired campaign,
persist secret-free raw and derived evidence, and report capability correctness,
failures, internal/external latency, Dynamic Worker usage, and bounded cost.

### P15 - Conclusions And Teardown

Status: complete. The bounded decision and complete script/namespace absence
proof are recorded in
[`P15-CONCLUSIONS-AND-TEARDOWN.md`](./P15-CONCLUSIONS-AND-TEARDOWN.md).

State whether the SessionDO-hosted mock executor met the predeclared latency and
correctness threshold without treating mock evidence as a Postgres commit
result. Purge application state, remove every temporary Cloudflare resource,
prove absence, and commit only the isolated app files.

### P16 - Facet-Resident Executor A/B Preflight

Status: complete. The exact trust boundary,
matched control/candidate paths, frozen 28-sample matrix, latency thresholds,
fresh USD 0.25 ceiling, and teardown contract are recorded in
[`P16-FACET-RESIDENT-EXECUTOR-AB-PREFLIGHT.md`](./P16-FACET-RESIDENT-EXECUTOR-AB-PREFLIGHT.md).

The candidate receives one trusted synthetic snapshot before handler execution,
performs its logical read, journal, result, and sealed commit-intent work inside
the attempt facet, and makes no in-handler read-capability call. Postgres, OCC,
physical planning, authoritative outcomes, and real sync remain non-goals.

### P17 - Implement And Prove Facet-Resident Execution Locally

Status: complete. The implementation and local receipt are recorded in
[`P17-LOCAL-FACET-EXECUTOR-PROOF.md`](./P17-LOCAL-FACET-EXECUTOR-PROOF.md).

Implement the strict snapshot-seeded facet request and sealed intent response,
matched trace/evidence contracts, attempt-fenced cleanup, and frozen campaign.
Prove exact correlation, forged evidence rejection, replay/conflict/busy
behavior, zero candidate read calls, completed and unstarted purge, full tests,
typecheck, Wrangler dry-runs, and clean mandatory reviews.

### P18 - Run The Bounded Production Facet A/B

Status: complete. The sanitized production receipt is recorded in
[`P18-PRODUCTION-FACET-EXECUTOR-AB.md`](./P18-PRODUCTION-FACET-EXECUTOR-AB.md).

Deploy only the isolated probe, run the immutable P16 campaign within the fresh
USD 0.25 ceiling, persist and reread secret-free evidence, report matched
correctness and latency plus Dynamic Worker usage/cost, and purge application
state.

### P19 - Conclusions And Teardown

Status: complete. The bounded decision and complete absence proof are recorded
in [`P19-CONCLUSIONS-AND-TEARDOWN.md`](./P19-CONCLUSIONS-AND-TEARDOWN.md).

Apply the predeclared mechanical, locality, and end-to-end thresholds without
claiming a real Postgres executor result. Remove every temporary Cloudflare
resource, prove script and namespace absence, record the bounded architecture
meaning, and commit only the isolated app files.

### P20 - Facet Finalizer A/B Preflight

Status: complete. The approved trusted-shell boundary, recovery challenge,
frozen 28-execution matrix, performance thresholds, and fresh USD 0.25 ceiling
are recorded in
[`P20-FACET-FINALIZER-AB-PREFLIGHT.md`](./P20-FACET-FINALIZER-AB-PREFLIGHT.md).

The candidate moves synthetic intent verification, attempt phase transition,
and the one narrow atomic-finish call into platform-owned facet shell code.
User code receives no capability, and this no-Postgres app makes no real commit
claim.

### P21 - Implement And Prove Facet Finalization Locally

Status: complete. The implementation boundary and final local receipt are
recorded in
[`P21-LOCAL-FACET-FINALIZER-PROOF.md`](./P21-LOCAL-FACET-FINALIZER-PROOF.md).

Prove exact capability scoping, one candidate finish call, zero SessionDO finish
calls, combined-receipt correlation, replay/conflict behavior, trace topology,
full tests, typecheck, Wrangler dry-runs, and clean mandatory reviews.

### P22 - Run The Bounded Production Facet Finalizer A/B

Status: complete. The immutable campaign produced 28 complete samples, 24
eligible matched measurements, zero correctness exclusions, publishable
evidence, a terminal application purge, and the sanitized receipt in
[`P22-PRODUCTION-FACET-FINALIZER-AB.md`](./P22-PRODUCTION-FACET-FINALIZER-AB.md).

The candidate passed the mechanical capability and ownership rules but failed
both parts of the frozen performance gate: paired internal improvement was
-1.07% and aggregate internal p95 regressed 50.02%.

### P23 - Conclusions And Teardown

Status: complete. The decision, Postgres-authority boundary,
uncertain-outcome recovery cutline, and complete script/namespace absence proof
are recorded in
[`P23-CONCLUSIONS-AND-TEARDOWN.md`](./P23-CONCLUSIONS-AND-TEARDOWN.md).

The experiment accepts trusted facet finalization as mechanically feasible but
does not promote it on latency or treat the mock as a real Postgres/OCC proof.

### P24 - Warm Facet Finalizer Preflight

Status: complete. The approved stable-facet lifecycle, frozen eight-series and
88-request matrix, descriptive 20 percent threshold, USD 0.05 ceiling, failure
fence, and teardown contract are recorded in
[`P24-WARM-FACET-FINALIZER-PREFLIGHT.md`](./P24-WARM-FACET-FINALIZER-PREFLIGHT.md).

This is a later app-local experiment, not a current Flarex roadmap. It keeps a
unique attempt fence per request while reusing one named facet per series.

### P25 - Implement And Prove Warm Reuse Locally

Status: complete. The implementation, exact replay/conflict and cleanup proof,
251-test receipt, dry-runs, and clean mandatory reviews are recorded in
[`P25-LOCAL-WARM-FACET-FINALIZER-PROOF.md`](./P25-LOCAL-WARM-FACET-FINALIZER-PROOF.md).

### P26 - Run The Bounded Production Warm Probe

Status: closed as non-publishable partial evidence. Thirty-nine requests
completed, eight reached the same uncertain-outcome fence, 41 were not started,
and application purge completed. The successful cold/warm distributions,
failure limits, Dynamic Worker usage, and cost are recorded in
[`P26-PRODUCTION-WARM-FACET-FINALIZER.md`](./P26-PRODUCTION-WARM-FACET-FINALIZER.md).

### P27 - Conclusions And Teardown

Status: complete. The bounded decision, Postgres authority rule, ordered
cleanup, and exact script/namespace absence proof are recorded in
[`P27-CONCLUSIONS-AND-TEARDOWN.md`](./P27-CONCLUSIONS-AND-TEARDOWN.md).

## Goal Loop State

- Goal: complete. P24-P27 extended the isolated probe with one approved warm
  facet-finalizer lifecycle test and did not change active architecture
  roadmaps.
- Previous baseline: P11 closed and removed the original deployment; its
  ignored evidence remains secret-free and unstaged.
- Final result: implementation, full local proof, dry-runs, both mandatory
  reviews, partial production evidence, application purge, decision, and
  complete external teardown are recorded. Successful warm calls were much
  faster, but repeated uncertain outcomes made the campaign non-publishable.
- Terminal gate: satisfied. P27 recorded the bounded negative conclusion,
  preserved the no-Postgres limitation, removed all temporary
  Workers/namespaces, and proved absence.
