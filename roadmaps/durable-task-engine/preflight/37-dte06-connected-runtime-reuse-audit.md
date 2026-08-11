# Preflight 37: DTE06 Connected Runtime Reuse Audit

## Status

**Decision:** **admit approved** on 2026-08-11. Roadmap 06's provider, delivery
evidence, checkpoint, fenced repository, and persistence discovery remain
admitted and production-inert. The first approved implementation checkpoint
composes the backend trusted directory, Trigger-derived recovery decision, and
single-candidate dispatch/cancellation operation from the existing provider and
persistence owners. The second completes the canonical active-scope
continuation. The third completes the deterministic bounded multi-scope runner
core. All remain private and hostless. Connected persistence proof, the Worker
Loader task adapter, supervision, and private end-to-end proof remain pending.

The audit itself changed no code or runtime configuration. Its approved first
implementation checkpoint adds only private package code and private package
exports. It changes no schema, migration, route, binding, host, or deployment
configuration.

## Why This Gate Exists

The durable-task vision says source reuse is the default and reimplementation
is the last option. The first admitted `run-attempt-v1` map contains 29
decisions: 13 seam adaptations, 12 adapter translations, four discards, and no
unchanged entry. That is meaningful reuse of Trigger algorithms, control flow,
invariants, and tests, but it is not unchanged package or file reuse.

Later work correctly created Flarex-owned identity, Drizzle/Postgres,
trusted-scope, Cloudflare scheduling, provider, and delivery boundaries. Those
owners are necessary because Trigger's Prisma, Redis, organization, deployment,
and Node compute authority cannot become Flarex authority. However, those
Flarex foundations do not themselves prove that the remaining connected
Trigger runtime logic is being reused.

Continuing directly into more orchestration would risk converting a
source-first migration into a clean-room task-engine rewrite. This gate restores
the original order: inspect concrete Trigger source, retain the maximum coherent
control flow and tests, translate only the incompatible seams, and then prove
one useful vertical.

## Question

What is the smallest connected Trigger source and test closure that can be
adapted into one private Flarex task execution from a durable
`dispatch_attempt` effect through provider acceptance, runtime execution,
heartbeat or cancellation, fenced settlement, and restart recovery?

## Source Closure To Inspect

The audit must inspect the pinned Trigger commit for the concrete owners of:

1. dispatch or dequeue revalidation before compute starts;
2. provider or worker delivery and idempotent acceptance;
3. attempt supervision and execution-fence ownership;
4. heartbeat, lease renewal, and worker-loss detection;
5. cancellation delivery, generation ordering, and acknowledgement;
6. completion, failure classification, retry, and terminal settlement;
7. duplicate delivery, stale response, restart, and lost-response recovery; and
8. the upstream tests and fixtures that prove those flows.

The audit must follow transitive calls far enough to identify the connected
algorithm. Listing top-level filenames or describing similar behavior is not a
source closure.

## Audit Result

The mechanically readable candidate map is
[`source-map.connected-runtime-v1.json`](./source-map.connected-runtime-v1.json).
It is pinned to Trigger.dev commit
`f10bc23785e569e5d917318cf2033aabdbe96a0b` and records each upstream file hash,
selected symbol or control-flow segment, target owner, semantic change,
authority reason, retained tests, and required Flarex proof.

The ten new connected-runtime decisions are:

| Connected unit | Trigger owner | Class | Decision |
| --- | --- | --- | --- |
| dispatch preparation and stale revalidation | `DequeueSystem.dequeueFromWorkerQueue` | `T` | Preserve select, fresh revalidation, durable preparation, then external delivery; replace Redis, Prisma, Redlock, product joins, and queue payloads. |
| cold compute dispatch | supervisor `runQueueMessage` and `createWorkload` | `T` | Preserve delivery after preparation and failure as delivery evidence; replace the Node event host and workload manager with the Effect runner and Worker Loader provider. |
| unknown-delivery recovery | `WarmStartVerificationService.verify` | `S` | Preserve the exact moved/unchanged/probe-uncertain branch behind durable checkpoint and provider ports. |
| provider create certainty | `isRetryableCreateError` | `T` | Preserve retry-only-on-definite-noncommit and never convert timeout/lost response to rejection; defer concrete error mapping to a real provider adapter. |
| runner-initiated attempt start | workload `attempts/start` route | `D` | Do not add it: Flarex grants and fences the attempt before `dispatch_attempt`, so a second start callback would create conflicting authority. |
| runtime heartbeat callback | workload heartbeat route | `T` | Preserve exact-execution correlation and stale heartbeat behavior; translate to scope, attempt, fence, lease, and the existing lifecycle operation. |
| runtime completion callback | workload completion route | `T` | Preserve correlated completion ordering; add Flarex result publication, exact fence, and idempotent lost-response replay. |
| runtime cancellation delivery | `notifyRun` and socket guards | `T` | Preserve interruption-versus-acknowledgement and stale-runner exclusion; translate sockets to provider execution identity plus cancellation generation. |
| Trigger workload HTTP wire | core workload client | `D` | Replace with a private capability-authenticated Flarex task ABI; do not expose Trigger routes, envelopes, or retry policy. |
| Trigger supervisor and workload managers | supervisor process plus Docker/Kubernetes/compute managers | `D` | Reuse existing Flarex R2, HostKit, Worker Loader, cache, and isolation owners; do not transplant Trigger compute infrastructure. |

There is no legitimate unchanged (`U`) transplant in this connected closure.
That is not evidence that the audit failed. The portable run-attempt, retry,
cancellation, heartbeat/lease, stale-wake, and settlement core is already
covered by the admitted lifecycle map. What remains upstream is principally the
Redis/Prisma dequeue adapter, Trigger workload HTTP surface, and Node/Docker/
Kubernetes supervisor. Forcing those files unchanged would preserve precisely
the product and platform authorities this migration must replace.

The candidate map separately references, without claiming new reuse credit,
the already admitted lifecycle entries for lease/stall recovery and
success/failure/retry/cancellation settlement. The connected runner must call
those owners rather than copy their control flow.

## Retained Test Closure

The first connected vertical retains these upstream scenario families:

- `engine/tests/dequeuing.test.ts`: bounded dequeue plus recovery after a
  dispatch that did not start;
- `services/warmStartVerificationService.test.ts`: exact unchanged fallback,
  moved-state no-op, and no fallback on probe uncertainty;
- `workloadManager/compute.test.ts`: definite noncommit versus lost-response,
  timeout, and non-retryable provider outcomes;
- `engine/tests/heartbeats.test.ts`: heartbeat keeps execution alive, missing
  heartbeat recovery, and pending-cancel finalization;
- `engine/tests/cancelling.test.ts`: executing and dequeued cancellation races;
- `engine/tests/attemptFailures.test.ts`: retry, permanent failure, and OOM
  classification; and
- `runAttemptSystemReplicaLag.guard.test.ts` plus the focused system tests:
  current-authority reads and completion/cancellation correlation.

These are scenario inputs and first-failure/race expectations, not permission
to reuse Trigger's Testcontainers, Redis, Prisma, environment, worker, image, or
organization fixtures. The Flarex lanes use deterministic provider tests,
PGlite/Postgres transaction tests, Miniflare runtime tests, and the existing
65-vector lifecycle gate.

## Candidate Admission Decision

The approved **admit** decision is:

1. seam-adapt `WarmStartVerificationService.verify` into one pure
   `DispatchRecoveryDecision` with the same moved, unchanged, and uncertain
   branch order;
2. adapter-translate `DequeueSystem.dequeueFromWorkerQueue` plus the supervisor
   cold-create path into the already planned trusted directory and bounded
   connected runner, using existing C3 discovery, C2 repository, and
   `TaskComputeProvider` without copying SQL or lifecycle logic;
3. add no runtime attempt-start callback;
4. adapter-translate Trigger heartbeat, completion, and cancellation callback
   sequencing into one private Flarex durable-task runtime ABI owned beside the
   existing artifact runtime;
5. implement the provider with the existing Flarex materializer, HostKit,
   Worker Loader, cache, isolation, and restricted executor capabilities;
6. route heartbeat, cancellation acknowledgement, success, failure, and retry
   only through the existing `RunAttemptLifecycle`; and
7. defer real external-provider create-error mapping, warm placement,
   checkpoints, waitpoints, Docker/Kubernetes, public APIs, and production host
   activation.

This is the maximum coherent reuse available without importing the wrong
product authority. It reuses one portable connected decision directly at a
seam, translates six connected control-flow boundaries, reuses the already
admitted lifecycle core, and rejects three conflicting Trigger host or wire
owners.

## Required Source Map

For every selected Trigger symbol or coherent control-flow segment, record:

- pinned upstream commit, package, file, symbol, and relevant test;
- target Flarex owner, file, operation, and dependency direction;
- reuse class: unchanged, seam-adapted, adapter-translated, or discarded;
- the implementation or control flow retained, not merely the desired outcome;
- dependencies carved into Flarex ports;
- semantic changes and their exact authority or platform reason;
- hostile, race, crash, and uncertainty scenarios retained;
- new Flarex scope, Postgres, Cloudflare, Worker Loader, and bundle tests;
- provenance and license handling; and
- the reason a more direct reuse class is unsafe when translation or discard is
  selected.

An existing Flarex service or repository may be listed as a target seam, but it
does not count as Trigger source reuse unless the mapped Trigger control flow is
actually retained around that seam.

## Reuse Decision Order

Apply this order to each connected unit:

1. reuse unchanged when its contract and dependency closure are portable;
2. preserve its control flow and replace dependencies with narrow ports;
3. translate only the adapter mechanics whose owner must be Flarex;
4. discard or freshly implement only when Trigger product policy, authority,
   storage, host, or runtime coupling cannot be separated safely.

Convenience, naming preference, existing Flarex abstractions, or a desire for a
cleaner API is not enough to select a weaker reuse class.

## Existing Foundation Disposition

This audit does not reopen or invalidate:

- the admitted lifecycle aggregate, decisions, compatibility vectors, and
  private `@flarex/durable-task` package;
- trusted tenant-to-scope and immutable application-revision authority;
- Task System run creation, lifecycle, due-read, and requested-effect owners;
- the Drizzle/Postgres schema, migrations, transactions, and deadline policy;
- Roadmap 05's production-inert scheduler, Queue hint, and repair foundations;
- the provider-neutral contract and deterministic in-memory adapter; or
- DTE06-C1/C2/C3 delivery evidence, checkpoints, fenced repository, pending
  projection, and persistence discovery.

Those are accepted foundations. The correction is to describe them accurately
as transformed lifecycle code or Flarex-owned integration infrastructure and to
require a fresh source decision for the unimplemented connected runtime.

## First Connected Vertical

The admitted implementation plan must be the shortest private path that proves:

1. one immutable Standard Application `durable_task` definition and runtime
   binding;
2. one idempotent run and authoritative `dispatch_attempt` requested effect;
3. bounded trusted discovery and a fenced delivery claim;
4. provider acceptance through the existing provider contract;
5. execution through the existing Flarex artifact materializer and Worker
   Loader owner, without copying that runtime;
6. bounded heartbeat evidence or generation-correlated cancellation;
7. result-object publication plus fenced completion or retry settlement; and
8. duplicate delivery, worker loss, lease expiry, stale completion, restart,
   and lost-response recovery.

The first vertical remains private, deterministic where possible,
production-inert, and disabled by default. It does not require a public SDK,
dashboard, broad observability, waitpoints, batching, debounce, advanced
fairness, or production host.

The candidate implementation sequence is:

1. add the trusted backend directory plus a single-candidate runner against the
   deterministic provider, including the seam-adapted recovery decision;
2. prove exact dispatch/cancellation replay, two-host exclusion, pre-call
   release, post-start uncertainty, and restart without runtime execution;
3. add the Worker Loader provider adapter and the minimal private runtime ABI
   with heartbeat, completion, and cancellation acknowledgement only;
4. add bounded result-object publication and attempt supervision through the
   existing lifecycle owner; and
5. compose the private end-to-end run and close cold and cached Worker Loader
   materialization, success, retry, cancellation, worker-loss,
   stale-completion, and lost-response evidence before any host activation.

Steps 3 through 5 may expose a concrete missing prerequisite. Such a blocker
must be recorded at its owner and approved; it does not authorize another broad
foundation layer or a duplicated lifecycle/runtime path.

## Completion Evidence

The source investigation, candidate map, and explicit approval satisfy every
evidence item below:

- the connected upstream dependency and test closure is recorded;
- every selected unit has an exact reuse class and target owner;
- every translation or discard has a written authority or platform reason;
- retained upstream tests and new Flarex tests are named;
- the smallest end-to-end implementation sequence and stop boundary are fixed;
- no additional generalized foundation precedes the private vertical without a
  demonstrated blocker;
- provenance and boundary gates are identified; and
- the user explicitly approves the resulting source map and implementation
  checkpoint. **Complete 2026-08-11.**

The first connected checkpoint is verified by:

- `pnpm --filter flarex-backend typecheck`;
- `pnpm --filter @flarex/persistence-postgres typecheck`;
- `pnpm --filter flarex-backend test:dte06-c3` (three files, 13 tests);
- the Trigger compatibility boundary test (25 tests) and live checker; and
- the connected-runtime source-map checker, including pinned upstream hashes,
  approval, implemented targets, license notices, and backend provenance.

These are focused unit, type, provenance, and package-boundary receipts. They do
not claim the still-pending connected continuation/restart behavior against
PGlite or genuine PostgreSQL.

The second backend checkpoint adds the strict canonical active-scope
continuation. `pnpm --filter flarex-backend typecheck` and
`pnpm --filter flarex-backend test:dte06-c3` passed five files and 32 tests at
that checkpoint,
including operation-exact error typing, hostile/excess input rejection,
canonical-byte and digest checks, intrinsic/detached byte-view handling, exact
directory/operation correlation, and
restart-stable per-operation page charges, including conservative charges when
an admitted page returns no trusted cursor. This pure-codec receipt does not
claim runner restart, fairness, or connected database behavior.

The third backend checkpoint implements the private bounded alternating runner
core and updates the applicable approved source-map targets from planned to
implemented. Unknown-delivery recovery remains planned until the runner owns
the mapped verification probe and three-way recovery decision.
Its deterministic suite proves exact active-scope resume through a fresh Layer,
later-scope progress, independent dispatch/cancellation turns and ceilings,
conservative unknown-progress and timeout charges, separate confirmed counters,
receiver preservation, hostile directory-page failure, fail-closed scope
re-resolution, strict resumed snapshot/page correlation, deterministic timeout
settlement, and preservation of external interruption without a receipt. The
current focused command passes five files and 42 tests. The separately approved
control-directory persistence correction now reuses the replacement-scope query
behind an opaque deadline-owned transaction target. Its focused PGlite test
passes three tests, and its ordinary-role genuine PostgreSQL 18 lane passes two
tests including server-side lock timeout, settled rollback, pool reuse, and
post-timeout progress. This still does not close the bounded connected runner
gate or claim connected PGlite/PostgreSQL restart, two-host exclusion, or
transaction/provider composition; those are the next C3 gate.

## Stop Boundary

The approved source map authorizes only the implementation sequence above. It
does not authorize work beyond the current Roadmap 06 checkpoint:

- do not add a task Worker Loader route, runtime ABI, supervisor, heartbeat,
  result publisher, or settlement composition;
- do not change the admitted Task lifecycle, schema, migration, repository, or
  discovery semantics merely to simplify the future runner;
- do not add a real Cloudflare provider, Queue/cron host, route, binding,
  deployment, public API, observability UI, or production activation; and
- do not claim Trigger runtime integration or parity from the completed
  foundations alone.

## Next After This Gate

The trusted backend directory, candidate-local authority timeout, freshly
resolved single-candidate provider operations, canonical active-scope
continuation, and deterministic bounded alternating runner core are complete.
Next, prove runner restart, fairness, two-host exclusion, and conservative
unknown-progress accounting against the real C2/C3 persistence owners. The
deadline-owned control-directory prerequisite is complete; the next test must
compose that owner with the existing C2 repository, C3 operation discovery, and
deterministic provider. Only after that checkpoint may the mapped Trigger
orchestration continue through Worker Loader execution and fenced settlement.
Only blockers discovered by that vertical may justify another foundation
preflight.
