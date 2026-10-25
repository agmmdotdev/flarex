# Task Logical Storage And Authority

Status: **accepted storage destination; schema and runtime proofs pending**.
The [Task design index](./README.md) and
[shared logical storage design](../flarexdb-shared-logical-storage.md) govern.

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

Business operations record enqueue intent through their existing durable
publication/outbox owner; idempotent Task creation follows. Direct enlisted
creation requires proved shared settlement and placement. Colocation alone
does not make two independently committed calls atomic.

## Acceptance And Cost

Logical storage is selected for shared ownership and machinery, not a claimed
performance win. Prove atomic operations, isolation, private access and recovery
on PGlite and ordinary-role real PostgreSQL separately. Measure indexed due
discovery, claim contention, heartbeat write/index amplification, independent
scope contention and bounded fan-out. Fix missing guarantees at the shared core
owner; no Task-adapter raw SQL, unbounded scan, local uniqueness map, extra
transaction or retained physical Task fallback may hide a core gap.
