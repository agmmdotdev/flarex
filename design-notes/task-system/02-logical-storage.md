# Task Logical Storage And Authority

Status: **accepted storage destination; schema and runtime proofs pending**.
The [Task design index](./README.md) and
[shared logical storage design](../flarexdb-shared-logical-storage.md) govern.
The accepted pairing is Convex-style internal logical storage with the
independently maintained Trigger fork as the Task engine.

## All Task-Owned State Is Logical

Use platform-installed private logical definitions over shared physical Flarex
storage. There is no new physical Task schema/table/index family per application,
tenant, deployment or framework, and no separate shared physical Task table set.
Retire the current Task-specific physical schema completely after cutover.

| Logical area | Required records |
| --- | --- |
| App/environment execution scope | Definition bindings and request identities, runs, attempts/snapshots, queue reservations, due work, dispatch/completion receipts, durable Task effects, required waits and checkpoints |
| Private platform scope(s) | Task discovery directory, pending-scope/partition work hints, scheduler leases/fences, repair cursors/checkpoints and Task-specific routing projections |

These are responsibilities, not finalized table names or a copy of every Trigger
model. Use one platform-maintained Task schema contract, bound to authenticated
scopes. Application, Payload and Medusa in the same admitted scope share that
Task owner. A tenant ID alone is not data-plane authority. Exact logical
definitions, keys, placement and installation dependencies remain an
implementation gate.

Platform-level Task data is logical too. Calling a row "routing", "repair" or
"control plane" does not exempt Task-owned state from this decision. A Task
directory may reference the existing general Flarex locator/catalog; it must
not duplicate that authority. Generic physical storage, core catalog, core
settlement and other genuinely shared infrastructure remain with their owners.
This does not authorize deleting all physical system tables in Flarex.

## Convex Storage Reference

The inspected source is the enclosing Convex checkout at
`84fbb0e70b4e857913673871cb847ad11a55f3d5`, matching the
[core source identity](../../experiments/core/REFERENCES.md#convex-source-identity).
The inspected files match that local revision. This identifies the
open-source mechanism; it is not a claim about Convex Cloud's private deployment
or a requirement to copy Convex's SQL layout or system-table names.

| Convex source | Mechanism | Flarex decision |
| --- | --- | --- |
| [Scheduler model](../../../../crates/model/src/scheduled_jobs/mod.rs) and [argument table](../../../../crates/model/src/scheduled_jobs/args.rs) | `_scheduled_jobs` and `_scheduled_job_args` are internal logical system tables; `SchedulerModel::schedule` inserts their records in its supplied transaction | Register platform-owned Task logical definitions and records through existing Flarex catalog, storage and settlement owners |
| [System metadata model](../../../../crates/database/src/bootstrap_model/system_metadata.rs) | `SystemMetadataModel::insert_metadata` resolves a namespaced table identity and calls the shared transaction's document insertion path | Reuse shared logical persistence with trusted private capabilities; no separate Task SQL persistence family |
| [Virtual table mapping](../../../../crates/model/src/scheduled_jobs/virtual_table.rs) | `_scheduled_functions` exposes a developer-facing projection of internal job records | Preserve admitted Task status/cancel APIs; storage sharing does not expose raw lifecycle writes or automatically add a `db.system` API |
| [PostgreSQL persistence](../../../../crates/postgres/src/sql.rs) | Shared physical `documents` and `indexes` carry logical table/index identities; multitenant mode also uses `instance_name` | Keep Flarex's shared physical storage families and authenticated scope identities; per-app Task schemas do not create PostgreSQL schemas, tables or indexes |
| [Scheduler execution](../../../../crates/application/src/scheduled_jobs/mod.rs) | `ScheduledJobContext::stream_jobs_to_run` queries the logical `by_next_ts` index across known namespaces | Discover due work through bounded indexed logical reads; the Trigger fork drives admitted claims and transitions, with host wake-ups injected |

Convex's PostgreSQL adapter still creates a general SQL namespace and shared
infrastructure tables. The relevant property is the absence of a dedicated SQL
table family for scheduled jobs. Flarex likewise retains generic physical
storage/catalog/settlement infrastructure while retiring every Task-specific
physical object.

For Flarex, a Task logical schema is a platform-maintained set of table, index
and constraint definitions bound to a private execution or platform scope.
It is installed alongside app/framework logical data without app-authored
schema definitions or per-app SQL DDL. Shared backing tables do not collapse
those scopes, permissions or transaction profiles.

This storage decision does not adopt Convex's scheduler implementation, Workflow
component or Workpool as another Task engine. The Trigger fork retains the
required attempt, retry, cancellation, waitpoint and recovery methods. The
Convex action/mutation distinction remains a separate
[developer contract](./01-engine-and-integration.md#convex-developer-model).
Flarex's partitioned placement, private platform discovery and bounded repair
are explicit adaptations: Convex's namespace enumeration is source evidence,
not permission to scan every Flarex application on each scheduler wake.

## Installation, Access And Lifetime

The platform installs and evolves Task schemas independently of app-written
schemas, Payload configuration and Medusa module choices. Apps cannot redefine
these tables or change lifecycle fields through ordinary `ctx.db`, collection
writes or repositories. Reserved names alone provide no protection: every read,
write, scan, index, relation and maintenance path must enforce the private
capability and scope contract. User-facing status/cancel operations use Task APIs.

Task schema identity and records survive application code redeployment. Each run
still pins its admitted definition/runtime revision. Platform Task schema
evolution must handle existing records explicitly; it is not ordinary deletion
of an old app schema. Reuse shared installation/readiness and bounded evolution
mechanics. A generic logical schema does not make data conversion unnecessary.

Provision a platform logical scope through existing core catalog/installation
owners. Prove bootstrap and discoverability without depending on the Task engine
to run its own first installation. Platform capabilities are unavailable to
application code and must not grant arbitrary access to unrelated scopes.

## Store Contract And Settlement

Narrow Trigger's RunStore into finite semantic operations with exact result
types, indexes and total row/byte/work bounds. Remove generated Prisma ownership,
arbitrary `where/select/include`, raw clients and per-call independent settlement.
Do not build a general Prisma emulator or translate individual Redis commands.

The trusted outer Task transaction owner settles. Adopted engine methods may
perform multiple awaited store operations through a private borrowed context.
Use short READ COMMITTED Task operations with database time and fresh-statement
visibility where waitpoint completion races require it. Application OCC and
framework profiles remain distinct. A transaction never spans handler execution,
remote effects, workflow waits or a process lifetime.

Required atomic units include:

- scoped create/replay/conflict acceptance and durable initial intent;
- eligibility recheck, capacity reservation and fenced dispatch ownership;
- start receipt, attempt ordinal and executing snapshot/effects;
- heartbeat renewal with current ownership and expiry checks;
- terminal or retry transition, capacity release and durable follow-up intents;
- checkpoint revision/digest acceptance with blocked state and lease retirement;
- winning wait resolution with resumable continuation work.

Use stable operation identities to reconcile lost commit responses. Check live
fences at authoritative writes, not only in a worker or queue adapter. Audit the
entire lock graph, including scope admission, run, waitpoint/checkpoint, queue
reservation, child effects and core index/uniqueness/publication locks. Do not
substitute a scope-wide exclusive lock for missing concurrency proofs.

## Discovery, Placement And Recovery

Use scoped indexed access for run identity, request-key uniqueness, due work,
active expiry, reservations, pending effects, wait blockers and continuation
progress. Platform discovery must find scopes with pending work without scanning
all applications or all runs. Bound every page and total invocation; persist
continuation progress for fan-out and repair so reaching a budget does not lose
work. Include fairness/resource bounds between quiet and busy scopes.

Co-locate each run and its required atomic records in the first profile. A
platform directory on another scope/database is a discovery projection, not
the run's commit authority. Publish directory changes through durable intent
and idempotent delivery; retain a bounded reconciliation route through the
trusted core partition directory so a lost hint cannot strand work. Prove stale,
missing and duplicate directory entries, restart and resharding interactions.
Do not assume cross-scope/database writes are atomic. Cross-partition waits and
global capacity reservations need a separately admitted durable protocol.

Store required bounded checkpoint bodies in logical Postgres records initially.
Measure complete encoded size, topology and retention requirements. Larger
bodies require an explicit storage design, never an automatic fallback. Existing
general artifact/input/result object-storage owners may be reused where admitted;
their Task-owned database references still follow the logical-storage rule.

## Atomic Enqueue And External Effects

Preserve Convex's mutation scheduling property: a committed business mutation
must also durably commit its enqueue obligation, and rollback must leave no
obligation. In Convex, `SchedulerModel::schedule` writes through the mutation's
transaction. In Flarex, business operations record enqueue intent through their
existing durable publication/outbox owner in the business transaction;
idempotent Task creation follows. This commits the obligation atomically, not
necessarily the final Task run record in that same transaction.

Direct enlisted Task creation requires proved shared settlement and placement.
Colocation alone does not make two independently committed calls atomic. A
business commit followed only by a queue send or a separate best-effort Task
insert is insufficient. Prove rollback, crash after commit before delivery,
duplicate delivery and lost commit-response recovery through the selected owner.

External actions/handlers run after settlement. They may enqueue further work
in separately committed operations; a later handler failure does not roll back
those commits. Trigger retry policy applies only to explicitly admitted Task
attempts. Logical persistence does not make external side effects exactly once
or silently change ordinary Application action semantics.

## Acceptance And Cost

Logical storage is selected for shared ownership and machinery, not a claimed
performance win. Prove atomic operations, isolation, private access and recovery
on PGlite and ordinary-role real PostgreSQL separately. Measure indexed due
discovery, claim contention, heartbeat write/index amplification, independent
scope contention and bounded fan-out. Fix missing guarantees at the shared core
owner; no Task-adapter raw SQL, unbounded scan, local uniqueness map, extra
transaction or retained physical Task fallback may hide a core gap.
