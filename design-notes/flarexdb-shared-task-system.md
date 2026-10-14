# Shared Task System From The Trigger.dev Fork

## Status And Authority

Status: owner-selected replacement direction recorded for design and planning.
Implementation contracts and the first connected migration remain subject to a
focused preflight. Creating this note does not authorize runtime changes, a
storage migration, data deletion, public APIs or production activation.

The owner wants one task primitive that Flarex Application, Payload and Medusa
can build on. Preserve actual Trigger.dev task implementations in maintained
fork packages, adapt their dependencies to Flarex core and logical storage,
remove Prisma and Redis from the admitted runtime, and retire our displaced
task implementation as consumers migrate.

The [accepted database design](./flarex-db-accepted-design.md),
[shared logical storage](./flarexdb-shared-logical-storage.md) and
[package boundaries](../roadmaps/16-package-boundaries.md) continue to govern
authority, isolation, settlement and migration. The
[existing task design](./flarex-durable-task-engine.md) and
[task roadmap](../roadmaps/durable-task-engine/README.md) describe the implemented
baseline. Their prescribed custom lifecycle, Application-centered admission and
inactive-only Trigger source policy are replacement targets identified here.
Reconcile those owners and their executable guards in the implementation
preflight; do not silently treat the old policy as permission to recreate the
engine again, or this note as permission to bypass current admission checks.

This work is distinct from the
[mixed mutation proposal](./flarexdb-mixed-mutation-execution.md). Sharing a task
engine does not make independently committed framework operations atomic or
start that separately gated core redesign. Coordinate with active shared-storage
work before selecting implementation ownership and a stable core checkpoint.

## Intended Outcome

Application, Payload and Medusa should submit, inspect and cancel work through
one task system. Their handlers execute through their own admitted framework
contexts. Framework features can build on the shared run, attempt, retry,
delay, cancellation and recovery primitives without creating another scheduler
or lifecycle authority.

The implementation should retain recognizable Trigger engine methods and tests.
Upstream fixes should be assessable as patches to a maintained fork. Recreating
equivalent behavior in a new Flarex state machine does not meet this source-reuse
goal, even when a provenance map or compatibility test describes the relationship.

The target has:

- one durable task lifecycle owner across all three consumers;
- Postgres-authoritative state behind private Flarex Task System capabilities;
- reserved logical task schemas using shared storage and schema machinery;
- core-owned transactions, scope checks, fencing, publication and recovery;
- retained Trigger task rules, with explicit necessary fork adaptations;
- framework-owned business semantics and execution contexts; and
- no active Prisma client, Redis client, Redlock or parallel task engine after
  the affected capability has completed its cutover.

Public API names, full Trigger SDK compatibility, dashboards, observability
products, hosted activation and all upstream capabilities are not implied by
this target. Admit a connected capability and its dependency closure at a time.

## What The Source Investigation Established

The reference source is pinned by
[`third_party/trigger.dev/SOURCE.json`](../third_party/trigger.dev/SOURCE.json)
to `f10bc23785e569e5d917318cf2033aabdbe96a0b`. The source island remains the
upstream reference; promoted executable fork packages need their own explicit
admission and source-preservation records.

| Evidence | Consequence |
| --- | --- |
| Trigger's [RunStore](../third_party/trigger.dev/upstream/internal-packages/run-store/src/types.ts) exposes lifecycle operations and `runInTransaction`. | There is an existing repository boundary to adapt while retaining engine methods. |
| [RunEngine](../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/index.ts) accepts a store and control-plane resolver, but constructs Redis locks, queues and workers. | Retaining the engine is credible; constructor injection alone is insufficient. |
| [SystemResources](../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/systems.ts) supplies dependencies to connected subsystem classes. | Refactor the fork's dependency boundary instead of copying each subsystem into Flarex glue. |
| The [run-operations schema](../third_party/trigger.dev/upstream/internal-packages/run-ops-database/prisma/schema.prisma) contains 16 task-related models and separates control-plane relationships. | It is useful model and invariant evidence, not a required copy set or physical schema destination. |
| [RunAttemptSystem](../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/runAttemptSystem.ts) still performs direct Prisma lookups for task, queue and product/runtime metadata. | Complete the store/resolver seam and remove bypasses from admitted code. |
| Our [lifecycle source map](../packages/durable-task/trigger-source-map.json) records 13 seam adaptations, 12 translations, four discards and no unchanged entry. | The existing lifecycle is transformed behavioral reuse; this replacement seeks stronger implementation preservation. |

The research established a feasible source-level direction. It did not execute
the proposed fork against Flarex logical storage or establish a retained-code
percentage, effort estimate, performance result or production-readiness claim.

## The Medusa Pattern To Follow

Our [Currency adapter](../packages/medusa-adapter/src/modules/currency/service.ts)
constructs the real `CurrencyModuleService`. Native service methods execute,
while the [repository adapter](../packages/medusa-adapter/src/modules/currency/repository.ts)
translates their persistence operations. The
[repository context](../packages/medusa-adapter/src/repository/context.ts)
borrows a core-owned transaction context and cannot independently settle it.

Apply the same principle to Trigger:

1. Keep the actual engine systems, decisions and connected control flow.
2. Change their persistence, identity, coordination and host dependencies in the
   fork where required.
3. Implement those capabilities using the correct Flarex owners.
4. Retain upstream behavioral witnesses and add Flarex boundary proofs.
5. Remove displaced implementations and adapters during consumer cutover.

Some method bodies must change to respect Flarex transaction and recovery
guarantees. Source reuse does not require preserving an unsafe effect placement,
an incompatible transaction handle or an unrelated Trigger product dependency.
Record those changes explicitly and keep the surrounding task logic recognizable.

## Target Ownership And Dependency Direction

```text
Application adapter     Payload adapter     Medusa adapter
          \                   |                  /
                   shared Task System
                           |
                retained Trigger engine
                  /                   \
       adapted store/coordination     runtime/compute adapters
                  |                            |
       Flarex logical storage         existing Flarex execution
       and trusted transactions       and artifact owners
                  |
               Postgres
```

| Owner | Responsibility |
| --- | --- |
| Retained Trigger engine | Task decisions and lifecycle orchestration: admitted run/attempt, retry, cancellation, delay, heartbeat, waitpoint, batching and scheduling policy. |
| Private Task integration | Scoped task admission, definition/runtime resolution, repository translation and coordination contracts required by the retained engine. |
| Persistence core | Logical rows/indexes/relations, conditional writes, transactions, database time, fencing, durable publication and uncertain-outcome recovery. |
| Framework adapters | Definition binding, authorization, enqueue intent and native handler context. |
| Application/Payload/Medusa | Their own validation, hooks, services, data operations and workflow semantics. |
| Runtime and compute owners | Immutable artifacts, execution identity, sandbox launch, supervision, cancellation delivery and resource cleanup. |
| Cloudflare wake adapters | Wake hints and durable repair/discovery triggers; they do not own run truth. |

These are responsibilities, not a requirement to create a package for every row.
Reuse existing owners. Keep construction cohesive and use direct bindings rather
than a universal framework dispatcher or a registry of duplicated engines.

## Prisma Decision: Remove Runtime, Adapt The Store

The selected destination is a Flarex implementation of Trigger's repository
boundary over logical storage. Remove Prisma from the active dependency graph
of each migrated capability. Preserve useful `RunStore` operations and result
contracts where possible; change Prisma-specific portions deliberately.

Current `RunStore` types expose `PrismaClientOrTransaction`, generated payloads,
`where`, `select`, `include`, and broad waitpoint query arguments. Keeping that
interface verbatim would make the adapter responsible for a large Prisma subset.
Instead:

- replace physical Prisma clients with private scoped store/transaction context;
- admit the concrete query, relation and projection shapes used by retained code;
- move domain record types out of generated Prisma-client ownership;
- translate required unique/conflict/error decisions at the persistence boundary;
- remove direct Prisma fallback paths from the admitted engine; and
- keep retry, cancellation and other task policy with retained engine methods.

### Alternatives Considered

| Alternative | Disposition |
| --- | --- |
| Real Prisma over reduced private task tables | Technically possible, but not selected for the logical-storage destination. It would need explicit Flarex session, scope and settlement integration. |
| Prisma driver adapter over Flarex logical records | Reject as the default. Driver adapters receive generated SQL, so this would require a substantial SQL-to-logical-storage translation layer. |
| General Prisma-client emulator | Reject. It would reproduce query, nested-write, result, error and transaction semantics and create another maintenance project. |
| Adapted RunStore using Flarex logical storage | Recommended target. Retain engine implementations and replace their storage mechanism. |

The pinned [Prisma 6.14 adapter interface](https://raw.githubusercontent.com/prisma/prisma/6.14.0/packages/driver-adapter-utils/src/types.ts)
accepts SQL and parameters. Changing its driver does not redirect model
operations automatically into Flarex logical tables. A shared connection pool
also does not establish shared transaction ownership.

Task records are platform control state, so generic application storage policy
did not by itself prohibit real Prisma over private physical tables. Logical
Task storage is an explicit replacement choice here, not a claim that the
earlier physical Task schema violated that policy.

The Prisma schema may remain pinned as build-time reference material. A finite
converter for logical definitions and record types is optional only when it
reduces ongoing maintenance. It must explicitly handle defaults, nullability,
relations, uniqueness and indexes and reject unsupported constructs. Do not
start a general Prisma schema/compiler project merely to avoid a bounded model
mapping. Schema conversion alone does not preserve transaction semantics.

## Reserved Logical Task Schemas

Model the entities required by the admitted capability: runs, attempts,
execution snapshots, creation/completion identities, scheduled work, queue
reservations and durable effects; add waitpoints, dependencies, batches and
checkpoints only with their connected capabilities.

Use shared logical definition, index, constraint, relation, installation and
readiness machinery. Task tables retain private system ownership and trusted
scope binding. Ordinary Application `ctx.db`, Payload collection writes and
Medusa repositories must not alter lifecycle state. Task schema installation is
a platform responsibility, not per-framework physical DDL.

Preserve useful upstream fields, relationships and statuses where they fit the
retained implementation. Do not force Trigger into our current custom aggregate
merely to keep its codecs, and do not copy all upstream product fields or tables
without a consumer. Resolve Trigger organization/project/environment lookups to
trusted Flarex identities and runtime projections; do not fabricate product
records or simply rename `organizationId` to `tenantId`.

Our current [logical store](../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts)
provides bounded reads, paging, count, limited aggregation, writes, deletes and
lifecycle operations. That is a foundation, not proof that it satisfies task
claims, queue reservations or the full RunStore query contract. Missing
guarantees belong in the responsible core owner, with a connected failing witness.
Adapters must not compensate with raw SQL, unbounded scans, local uniqueness
maps, extra transactions, weakened assertions or a fallback engine.

## Transactions, Concurrency And Durable Effects

The trusted outer owner settles. Store calls borrow the admitted Task operation
context. Preserve one coherent transaction for related run, attempt, snapshot,
queue and effect changes; do not open an independent transaction per repository
call. Database transactions must not span task execution, remote effects,
workflow suspension or long waits.

Required proofs include:

- scoped idempotent creation and replay/conflict handling;
- atomic attempt acquisition and execution evidence;
- indexed due-work selection and conditional claims under competing workers;
- atomic queue/environment/concurrency-key reservation and release;
- database-time leases, stale attempt rejection, lock order and nested ownership;
- atomic completion/retry/cancellation state and durable requested effects;
- exact event/snapshot ordering and corruption detection;
- read-your-writes, rollback-only behavior and transaction visibility;
- cancellation versus completion and waitpoint completion versus blocking races;
- confirmed rollback versus uncertain commit and fresh-host recovery.

A `find` followed by `write` is not by itself an atomic claim. A mutex or wake
message is not authority for a stale worker to commit. Keep fencing checks with
the authoritative writes. Do not assume a snapshot execution profile provides
the same behavior as Trigger's READ COMMITTED operations: its waitpoint store
deliberately performs a separate statement to observe concurrent completion.

### Necessary Changes Inside Retained Source

Current source provides concrete examples to address in the fork:

1. `startRunAttempt` already groups attempt increment and the EXECUTING snapshot
   through `runInTransaction`. Preserve that atomic unit. Snapshot creation also
   enqueues heartbeat work and emits events before the surrounding transaction
   necessarily commits; persist effects and deliver them after settlement.
2. `tryNackAndRequeue` exposes Redis retry work before updating the run and queued
   snapshot. The replacement needs an atomic durable transition or an explicitly
   recoverable effect sequence.
3. `attemptFailed` accepts a transaction argument but uses the root Prisma client
   for several operations. Make the retained flow use one admitted context.
4. Trigger's queue permit release during cancellation is not identical to an
   active operating-system process count. Preserve or explicitly revise that
   policy; do not change it incidentally while replacing storage.
5. Flarex currently grants an attempt before dispatch, while Trigger has a
   runner-initiated start path. Resolve that difference in one lifecycle owner;
   retaining both start authorities is not an integration solution.

These changes must be visible in the source adaptation inventory and tested as
such. They are not grounds for replacing all retained orchestration with another
state machine. Task retries also do not make arbitrary external side effects
exactly once; admitted handlers and effect adapters need appropriate idempotency
and reconciliation contracts.

## Redis Removal

Redis owns more than caches in the pinned engine. Replace each admitted
responsibility at the correct boundary:

| Existing mechanism | Replacement requirement |
| --- | --- |
| RunQueue sorted sets and Lua | Indexed pending work plus atomic eligibility, capacity reservation, acknowledgement and retry transitions. |
| Redlock and nested run locks | Core-owned ordering, ownership and database-enforced fencing. |
| Redis worker jobs | Durable heartbeat/TTL/repair/delay/cancellation jobs, with bounded discovery and idempotent delivery. |
| Fair-queue snapshot reads | Flarex-owned input snapshots while retaining portable weighting, shuffle and age policy. |
| Batch queue infrastructure | A connected batch coordination replacement when batches are admitted. |
| Product/runtime caches | Remove or replace as non-authoritative caches behind the actual resolver. |

The [queue implementation](../third_party/trigger.dev/upstream/internal-packages/run-engine/src/run-queue/index.ts)
atomically checks limits, chooses eligible work, reserves capacity and changes
indexes. Emulating individual Redis commands with separate logical writes would
lose that atomicity. Preserve the operation's meaning through a core transaction.

The [fair selection strategy](../third_party/trigger.dev/upstream/internal-packages/run-engine/src/run-queue/fairQueueSelectionStrategy.ts)
has reusable policy separated from Redis snapshot inputs. Retain its algorithms
where admitted. Selection remains advisory until an authoritative claim succeeds.

An isolated upstream reference-test environment may still require Redis. That
does not admit Redis into Flarex runtime packages. The immutable reference source
and the executable fork must remain distinguishable.

## Framework Adapters And Reliable Enqueue

The shared engine should accept trusted framework-neutral task definition and
runtime bindings. Stable scoped task identity, immutable handler revision,
payload/output contracts, queue/retry policy and compute requirements need one
canonical meaning. Framework adapters supply those bindings through admission;
they do not receive raw Task tables, database handles or settlement capabilities.

| Consumer | Adapter responsibility and current evidence |
| --- | --- |
| Application | Preserve analyzed definitions, active-revision validation, execution principal and query/mutation callbacks. Move Application-specific selection above the shared primitive. |
| Payload | Bind admitted native task/job definitions and execute through Payload context and Local API semantics. Jobs are currently disabled in the admitted adapter; this integration is new work. |
| Medusa | Bind admitted subscriber/job/workflow requests and invoke native services or workflows with their container/context. Preserve native business behavior and compensation meaning. |

The current [ApplicationTaskSystem](../packages/standard-application-invocation/src/ApplicationTaskSystem.ts)
and [definition references](../packages/durable-task/src/runAttempt/DefinitionReference.ts)
are tied to Application or retained Legacy generations. Replace that shared
contract where necessary; Payload and Medusa should not manufacture Application
identities. Keep backend analysis and immutable runtime authority intact.

[Payload configuration](../packages/payload-adapter/src/configuration.ts) currently
has no admitted job tasks/workflows. The
[Medusa workflow runtime](../packages/medusa-adapter/src/workflow/runtime.ts)
executes an admitted atomic workflow profile. A durable task may invoke that
profile as one committed operation. Do not silently reinterpret it as a workflow
with durable suspension or rollback across earlier commits. Assign task-attempt
retry and framework/workflow retry responsibilities explicitly to avoid duplicate
or multiplied retries.

For task requests originating in business transactions:

- rollback must leave no runnable task intent;
- commit must retain the intent despite process failure before dispatch;
- duplicate delivery must recover the same logical run;
- a replay must retain the intended immutable definition and authorization;
- separate framework calls retain their own transaction boundaries.

Use task creation enlisted in the same trusted settlement where proved, or
record an outbox intent atomically and create the run idempotently. A plain
after-commit callback leaves a crash gap. Cross-database placement requires a
durable handoff, not an implied distributed transaction.

Current [Application run creation](../packages/persistence-postgres/src/application/tasks/applicationTaskSystemRunCreation.ts)
owns a separate transaction; atomic business mutation plus task enqueue is not
already established. Medusa's committed event/delivery machinery is a candidate
handoff owner. Prove and extend the shared publication capability rather than
creating a separate outbox per framework.

## Source And Package Admission

Start from the connected run-engine systems, their existing store/resolver
contracts and required core types/tests. Package-by-package adoption must follow
that dependency closure; package names alone do not establish portability.

Retain the frozen upstream reference. Promote executable fork sources into
explicitly admitted packages, with the exact source pin, preserved paths or
mapping, and reviewable patches. Update workspace, import, bundle and provenance
guards for that specific admission. Do not merge the whole Trigger workspace or
make all of `@trigger.dev/core` an implicit runtime dependency.

Keep task rules in retained engine methods. Flarex adapters translate framework,
storage and host contracts; they must not contain a parallel set of retry,
cancellation, waitpoint or lifecycle decisions. Use genuine foreign/runtime
bridges for retained framework signatures and apply repository Effect standards
to owned boundaries without a stylistic rewrite of the upstream implementation.

For each connected capability, record:

- retained upstream files, methods, tests and exact source revision;
- unchanged, relocated and deliberately modified behavior;
- replaced infrastructure and the guarantees its replacement must provide;
- deliberate semantic differences and their failure/race witnesses;
- consumer migration, durable-data disposition and removal gates; and
- how a later upstream fix can be assessed and carried into the fork.

Do not select an arbitrary reuse percentage or treat line counts as correctness.
The acceptance question is whether actual retained methods execute and upstream
changes remain traceable, with all required Flarex guarantees preserved.

## Replacement And Cleanup Inventory

| Current owner | Planned disposition |
| --- | --- |
| `packages/durable-task/src/runAttempt/Layers/RunAttemptLifecycleLive.ts` | Replace the handwritten start, heartbeat, completion, cancellation and lease-expiry decisions with retained Trigger implementations; delete displaced decisions in the consumer cutover slice. |
| `packages/durable-task/src/runAttempt/Policy.ts` | Replace duplicate retry-delay and failure-policy algorithms with retained Trigger behavior; keep any required Flarex boundary validation with its actual owner. |
| Custom aggregate models, codecs, initial state and persistence projections | Adapt or replace around the retained engine; do not preserve them solely because they exist. |
| Pure-decider Task store contract and concrete persistence | Replace with the scoped store/transaction operations required by retained methods over logical storage. |
| Task run reads, history, results and cancellation APIs | Migrate to the new authoritative representation; keep intended supported behavior and scope checks. |
| Scheduling, repair and supervision code | Audit against retained Trigger policy; keep required host mechanics and recovery guarantees, remove duplicate orchestration. |
| Scope authority, database time, fencing, idempotency and uncertain-outcome recovery | Retain guarantees; adapt implementation coherently at their real owners. |
| Worker Loader, immutable artifact/input/result storage and execution principals | Reuse existing owners and adapt task contracts. |
| Application-specific definition/admission | Retain as an Application adapter; move shared task identity below framework-specific admission. |
| Prisma/Redis runtime dependencies and product-control lookups | Remove from migrated executable closures. Preserve isolated reference sources as evidence. |
| Old tests, source maps, exports, fixtures and documentation | Move behavioral coverage to the replacement and remove obsolete scaffolding in the same slice. |

Inventory durable environments and actual consumers before changing schemas or
identities. Account for Legacy/Application definition generations, run IDs,
creation keys, attempt fences, completion receipts, requested-effect sequences,
pending delivery/cancellation, repair cursors and R2 input/result/principal
references. Existence of a codec alone does not establish a shipped obligation;
absence of production activation does not prove all persistent data is disposable.

Use an explicit migration or owner-approved reset. Temporary retention requires
a named consumer and removal gate. Do not introduce production dual execution,
dual writes or fallback to the old engine. Differential execution belongs in
isolated tests. Completion means one lifecycle authority and accounted-for data.

### Cleanup Is Part Of Each Cutover

Removing the current reimplementation is a completion requirement. Do not
postpone it until every Trigger capability has been adopted. Each connected
replacement includes the following work:

1. **Identify the full affected path.** Inventory the old decision functions,
   store contracts, lifecycle gateways, creation code, readers, scheduler and
   supervisor callers, exports, dependencies and tests. Assign each item a
   replace, adapt, retain or delete disposition based on its responsibility.
2. **Prove the replacement.** Execute the retained Trigger methods through real
   Flarex storage and runtime boundaries, including the relevant race, rollback,
   stale-fence and uncertain-outcome witnesses.
3. **Migrate callers and durable state.** Switch the affected producers,
   execution callbacks, reads, history, results and cancellation paths together.
   Apply the recorded data migration or approved reset, including pending work
   and recovery identities. A new engine beside unchanged callers is incomplete.
4. **Move behavioral coverage.** Preserve meaningful existing regression
   assertions against the replacement, alongside retained upstream tests.
   Remove tests and fixtures specific to the obsolete implementation only after
   their required behavior is covered or an explicit contract change replaces it.
5. **Delete displaced code and storage paths.** Remove the old algorithms,
   unused aggregate models/codecs/projections, obsolete adapters, exports,
   dependencies, fixtures and source maps. Retire old tables and migration
   machinery only after their consumers and durable-data obligations are
   resolved. Update the affected design and roadmap owners in the same slice.
6. **Verify removal and commit the coherent result.** Check the owned source,
   import/export graph and runtime composition for remaining old-engine calls,
   alternate registrations and fallback behavior. Complete affected validation
   and required reviews before the scoped commit.

The lifecycle gateway and persistence adapter currently invoke our custom
decision functions. Migrate those contracts to the retained engine and its
Flarex-backed store; a compatibility wrapper that continues executing the old
decisions does not complete the replacement.

Evaluate `@flarex/durable-task` and neighboring modules by responsibility rather
than deleting whole packages by name. Scope authorization, transaction
settlement, database time, fencing, idempotency, recovery, immutable artifacts,
execution principals and Worker Loader integration remain necessary. Reuse
their correct owners and adapt contracts where required; remove duplicate task
policy from those owners when the retained engine takes over.

### Cleanup Acceptance

A migrated capability is complete only when:

- its active callers execute one retained Trigger lifecycle implementation;
- no old-engine fallback, dual write or wrapper keeps displaced decisions alive;
- the old runtime exports, dependencies and executable paths are removed;
- required behavior has regression coverage on the replacement;
- durable records, pending effects and recovery references have a recorded
  disposition; and
- any temporary retention names its remaining consumer, owner and concrete
  removal gate in the owning roadmap.

Final retirement audits these incremental removals. It does not defer them or
justify preserving an old engine for hypothetical compatibility.

## Recommended Implementation Sequence

### 1. Agree The Connected Fork And Core Contract

Write one focused preflight covering the admitted lifecycle source closure,
store/read operations, logical definitions/indexes, transaction/claim semantics,
task-definition boundary, deliberate upstream differences and retirement plan.
Reconcile the old source-admission policy and package guards. Identify required
core corrections and active ownership before edits. Do not make a helper-only
extraction or a general Prisma emulator the first deliverable.

### 2. Prove The Retained Lifecycle On Flarex

Execute actual upstream enqueue, claim, start, heartbeat, completion, retry and
cancellation methods through one Flarex-owned store and transaction profile.
Include competing workers, stale attempts, lost responses and fresh-host
recovery. Integrate the existing runtime/compute owners. Remove the displaced
current lifecycle as its real consumers move within the coherent cutover.

### 3. Prove All Three Consumers Early

Use an Application operation, a Payload operation/hook and a Medusa event or
workflow to record durable task intent. Execute their native handlers through
the same retained engine and recovery path. Prove rollback and crash-safe
handoff for each. This is an early architecture gate, not work deferred until
all upstream scheduling features have been ported.

### 4. Extend From Real Requirements

Admit delays, waitpoints, batches, broader fairness/concurrency policy and later
framework APIs through their connected source/test closures. A preserved class
or package does not automatically activate every capability. Keep hosted
activation and public API design under their explicit gates.

These are planning stages, not permission to ship an incomplete engine or leave
duplicates until the end. Each implementation slice includes affected consumers,
validation, review, cleanup and one scoped commit under repository policy.

## Validation And Completion Gates

- Retained upstream tests execute actual engine methods. Port construction and
  backend inspection while preserving lifecycle assertions; label intentional
  differences rather than weakening tests to match a rewrite.
- Preserve native start/write atomicity, heartbeat, cancellation, retry and
  waitpoint race witnesses. Test logical-store queries and constraints under
  their exact admitted bounds.
- Run PGlite and ordinary-role real Postgres proofs for transactions, claims,
  isolation, locking, visibility, migration and recovery; keep results distinct.
- Prove durable enqueue and handler execution from all three frameworks.
- Verify scope isolation, immutable definition binding, runtime principals,
  stale worker rejection and private system-table access boundaries.
- Measure indexed due discovery, reservation contention, heartbeat write
  amplification and scope-level serialization against explicit acceptance
  questions. Generic storage is not automatically faster or more concurrent.
- Check the admitted Worker/runtime bundle has no Prisma, Redis, Redlock or
  unintended Trigger product/Node supervisor dependency. Stop owned resources.
- Use repository typechecks, source guards, lint and both project reviewers for
  significant implementation changes. Docs-only planning needs proportional
  documentation checks.
- Reconcile the owning roadmaps when durable domain truth changes. Complete
  consumer/data disposition and remove displaced code, dependencies and tests.

Outstanding design questions are the exact store query contract, system logical
schema admission, claim/reservation primitives, transaction visibility required
by waitpoints, attempt-start ownership, task-intent publication and migration of
existing durable identities. Resolve them with the first connected proof rather
than assuming the current logical CRUD interface already supplies them.

The desired endpoint is a maintained Trigger implementation operating through
Flarex-owned logical persistence and execution, with Application, Payload and
Medusa building on the same task primitive.
