# Runtime Topology Probe Turn Plan

Status: experimental evidence plan; `P00` through `P07B` complete locally.
The first production target failed the P08 Paid-eligibility gate before P09
smoke execution and was fully cleaned up; P10 and P11 evidence remain pending.

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
- Gates `P02` through `P07B` are local and dry-run-only. `P07B` closes the local
  bounded-orchestration, evidence, reconciliation, and resumable-purge gates;
  production deployment remains blocked on the separate `P08` preflight.
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

Status: complete locally; not deployed.

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

Status: complete locally; not deployed.

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

Status: local evidence complete; first authenticated target proven ineligible
and cleaned up; eligible Workers Paid target pending.

This is a discussion/evidence gate before external state changes.

The frozen target, budget, commands, corrected smoke/measurement sequence, and
teardown are recorded in `P08-PRODUCTION-PREFLIGHT.md`. Authentication,
workers.dev subdomain, resource ownership, and the USD 2 incremental-cost
ceiling were proven. The first gateway upload returned Cloudflare code `10195`:
the account's Standard default usage-model setting did not prove a Workers Paid
subscription. The remaining exit condition is direct Paid-plan evidence for an
already eligible target; purchasing or changing a plan is outside the current
authorization.
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

Status: attempt 1 stopped before gateway creation; cleanup complete; no smoke
or latency evidence. A future attempt awaits an eligible Workers Paid target.

The sanitized attempt and absence proof are recorded in
`P09-PRODUCTION-ATTEMPT-1.md`.

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

Status: pending.

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

Status: pending.

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
- Current gate: `P08` is blocked on an eligible Workers Paid target. The first
  authenticated target rejected the gateway with code `10195`; its prior
  Standard usage-model setting was insufficient evidence. All scripts and
  namespaces created by that attempt are absent.
- Next action: identify an already eligible Workers Paid target within the
  existing USD 2 incremental ceiling, prove that subscription directly, then
  restart P09 from the same clean app checkpoint and fresh resource names. A
  subscription purchase or plan change requires new user authorization.
- Goal completion condition: production evidence and analysis are recorded and
  the approved cleanup/retention action is verified.
