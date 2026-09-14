# Shared Framework Integration Direction

## Shared Logical Storage Authority

The accepted [shared logical storage decision](./flarexdb-shared-logical-storage.md)
and [redesign roadmap](../roadmaps/shared-logical-storage/README.md)
replace the former deployment-owned commerce physical-table destination.
Application, Payload and Medusa target generic physical families with logical
tables, indexes, constraints and relations. Core and integration flows may be
redesigned cleanly during development; adapters must not compensate for missing
core contracts. Framework semantic ownership and singular settlement remain.

Descriptions below of current generated commerce tables, SQL indexes/FKs,
installation receipts and completed tests are baseline evidence. They do not
override the replacement target or prove its implementation. Physical lifecycle
work with retained system consumers must be inventoried before removal.

Date: 2026-09-08.

Status: accepted shared transaction/commit ownership direction with distinct
execution profiles. Core owns common guarantees; CMS and commerce retain
framework execution semantics through adapters. Named atomic composition,
general mixed OCC and workflow-runtime replacement remain separately gated
capabilities. This decision does not claim implementation or authorize changes
to the active Product work.

## Reading Order And Authority

Read this overview, then
[Medusa workflow execution](./flarexdb-medusa-workflow-execution.md), then the
[shared transaction and optional OCC preflight](./flarexdb-commerce-occ-migration-preflight.md).
Together they capture the side discussion about installation, core sharing,
adapter centralization, workflow reuse, transaction ownership, Payload lifecycle
compatibility, shared-core refactor scope and performance.

The [accepted database design](./flarex-db-accepted-design.md),
[framework storage architecture](./flarexdb-framework-storage-architecture.md)
and [framework roadmap](../roadmaps/flarexdb-framework-integration/README.md)
remain the implementation authorities. This clarification preserves their
shared-foundation/distinct-profile decision. Replacing Medusa workflow runtime
or extending native OCC to general mixed commands would be a separate amendment,
not an incidental requirement of framework integration or core consolidation.

## Handoff For A New Implementation Conversation

First finish the agreed Product original-test handoff and refresh the live
checkout, capability status and tests. Preserve unrelated work. These notes
record design direction, not fresh compatibility or benchmark receipts.

Map current native execution, CMS lifecycle/working set, commerce repositories,
core physical settlement, publication and recovery. Identify actual duplicate
guarantees or dependency problems. Both frameworks must delegate common
transaction and commit responsibilities to core; their legitimate lifecycle
and query semantics remain in profile adapters. Existing common infrastructure
may already cover a guarantee, in which case no replacement is needed.

Define the warranted bounded consolidation with affected owners, unchanged
framework assertions, failure/recovery and performance checks, and removal of
superseded code/schema. Preserve native OCC, admitted SQL isolation and lock
ordering. Do not require relational history, a universal pending-query layer
or new framework journals merely to centralize ownership.

Keep independent commands, named trusted composition and general mixed sandbox
mutations explicit. Named composition can use one bounded SQL transaction;
general mixed OCC requires its own snapshot, dependency and retry proof. The
workflow-reuse proposal has independent source/step/hook and Task gates.

Default success means core owns physical settlement, publication and recovery
through narrow capabilities, domain semantics are preserved, and displaced
duplication is removed. It does not require all-three tracked execution.
Public APIs, unrestricted hooks and production serving remain separate gates.

## User Intent

- Centralize database mechanisms and expose small, reusable internal contracts.
- Reuse Medusa models, module services, business validation, workflow steps,
  transformations and hooks wherever their semantics remain compatible.
- Make Flarex own coordination across modules, commits, recovery and durable
  execution. Module boundaries need not imply independently committed writes.
- Make native Application, Payload and Medusa use core-owned transaction,
  commit and recovery guarantees. Preserve native OCC and framework bounded
  SQL profiles; validate any new execution or composition contract separately.
- Consolidate proven adapter behavior before accumulating copies per module.
- Measure performance after correctness; address observed test slowness without
  weakening deadlines, integrity checks or compatibility assertions.

## Current Connection To Flarex

The integration replaces framework persistence underneath selected operations.
For Product, actual imported Medusa model definitions pass through its DML
compiler, the adapter's checked schema translation, and Flarex's physical
layout/migration machinery. The actual Product module service receives an
injected repository and persistence adapter.

```text
Medusa models -> checked DML metadata -> Flarex schema/layout -> installation

Flarex command and database transaction
  -> actual Medusa module service
  -> injected repository/manager bridge
  -> scoped Flarex store
  -> authoritative rows, change facts and commit/recovery publication
```

The [schema adapter](../packages/medusa-adapter/src/product-schema.ts),
[service composition](../packages/medusa-adapter/src/product-service.ts),
[shared repository context](../packages/medusa-adapter/src/commerce-repository-context.ts)
and [core command contract](../packages/persistence-postgres/src/commerceTransaction/commands.ts)
show these boundaries. The adapter is private and capability-limited. Importing
a model or installing all its tables does not admit every service operation.
The working tree may contain unfinished slices; code presence alone is not a
test or compatibility receipt.

## Logical Schema Evolution Is Separate From Requests

The accepted [shared logical storage replacement](./flarexdb-shared-logical-storage.md)
compiles Medusa DML into logical table/index/constraint/relation definitions
over generic physical families. Current code still installs physical module
tables; that path is a regression baseline to replace, not the destination.

Physical core migrations belong to the platform. Logical schema changes require
definition comparison, any necessary conversion/index build, and fresh
readiness/binding evidence. Shop or deployment creation does not allocate a
dedicated module schema. Ordinary requests use the admitted logical definitions.

Example: register a logical Product table, add a logical subtitle field through
a compatible definition update, and maintain logical index entries in shared
physical storage. Existing-record conversion remains explicit when needed.

The current shared roadmap records fresh installation and one bounded
fresh-base-to-additive-successor upgrade with independent database acceptance.
This is stronger than a blanket statement that no upgrades work, but does not
prove arbitrary Medusa model upgrades or destructive migrations. See
[the additive-upgrade contract](../roadmaps/flarexdb-framework-integration/preflight/12-base-backed-additive-upgrade.md).

## What Is Already Shared

| Consumer | Execution semantics | Shared foundation |
| --- | --- | --- |
| Native Flarex Application | Logical operations, read dependencies, OCC and admitted retry | Authoritative document/index/relation materialization and commit machinery |
| Payload | Supported request lifecycle, hooks and bounded CMS transaction | Application document storage and owned materialization/publication primitives |
| Medusa | Supported services and repositories inside bounded commerce transactions | Target shared logical storage; current generated relational storage remains the migration baseline |

Payload does not need a second authoritative copy of Application documents.
Medusa business records are reserved by semantic write authority, not dedicated
physical tables. Shared physical storage retains distinct framework lifecycle
and execution profiles; current core internals may be redesigned to support it.
See [the CMS implementation contract](../roadmaps/flarexdb-framework-integration/preflight/17-cms-request-transactions-and-application-publication.md).

There are already private core APIs. Currency and Product also share request
ownership and manager authentication in the Medusa adapter. Remaining work is
to complete and consolidate capabilities, not to invent a separate database
engine for each module. A new module should increasingly mean metadata,
explicit capability admission and compatibility tests.

## Clarified Destination: Core Ownership With Profile Adapters

Both framework transaction folders delegate common guarantees to core. They
must not maintain independent physical settlement, commit clocks, publication
or outcome-recovery authorities. They retain Payload lifecycle and Medusa
repository/manager translation, supported pending state and domain admission.

```text
Native Application -> snapshot / journal / OCC ------------------+
                                                               |
Payload / Medusa -> domain adapters -> bounded SQL execution ----+
                                                               |
               core-owned settlement, publication and recovery <-+
```

Sharing ownership does not require replacing framework execution with native
logical OCC. Sandbox isolation prevents unrestricted database access; it does
not select the concurrency algorithm for every trusted host operation.

| Call boundary | Atomicity contract |
| --- | --- |
| Native mutation | Native tracked execution and one outcome; reject independently committing framework calls inside it |
| Independent framework command | Core settles that command; a later coordinating action/task failure cannot undo its commit |
| Named trusted composite | Separately prove one bounded SQL transaction, authenticated participants and one finalizer |
| General sandbox interleaving of all three APIs | Optional stronger capability requiring a separate shared-OCC or equivalently proved execution contract |

The proposed `ctx.cms` and `ctx.commerce` syntax does not itself admit these
APIs or mixed atomicity. No SQL transaction spans arbitrary sandbox callbacks,
remote effects or workflow suspension. Framework built-ins do not make
user-authored hooks trusted; admit their execution and effect contract explicitly.

Native Application keeps its write policy. Payload keeps access, validation,
supported hook timing and request nesting. Medusa keeps services and commerce
invariants. Shared storage cannot authorize direct cross-domain writes.
The [detailed preflight](./flarexdb-commerce-occ-migration-preflight.md) separates
default consolidation, optional named composition and optional general OCC.

## Centralization Rule

1. Reuse an existing generic capability when it covers the module's behavior.
2. Extend its shared owner once when a real missing capability is demonstrated.
3. Keep Medusa-specific repository translation in the shared Medusa adapter.
4. Keep business behavior in its module/service or reusable workflow step.

A generic keyed update belongs in core. Tag naming, inventory rules and pricing
normalization do not. Generic installation, change and recovery machinery
should not gain a new family of module-named metadata tables for each module.
Module business tables still legitimately differ.

Finish the active bounded module slice before consolidating the bridge, then
use the same assertions to preserve its behavior. Consolidate observed common
semantics rather than prebuilding a universal adapter for untested features.
Remove the exact code, tables and temporary bridges that the approved slice
supersedes. Retain legitimate CMS working sets, SQL stores, native journals and
framework installation/migration data. Rebaseline unshipped disposable schema
or migrate durable obligations according to the accepted replacement policy.

## Events, Tasks And Query Sync

The current Product event path captures an admitted local message family,
checks it against authentic row changes and releases it after acknowledged
commit. Its in-memory destination is a local compatibility proof. It is not
durable business-event delivery, and replay or uncertain settlement must not
be treated as permission to deliver again.

Commit/change records and the common wake are infrastructure. They are not
automatically a durable queue of Medusa business-event payloads. Query sync
maintains client query results and is a separate consumer concern; it is not
the Medusa workflow engine or the business-event dispatcher.

The proposed workflow execution needs an explicit event-intent and durable-task
handoff contract. Reuse shared publication and Task infrastructure through
their owners; do not infer that an existing wake table completes that contract.

## Performance Position

One transaction may still issue many sequential database statements. Recording
all changes at commit provides consistency and recovery; it does not by itself
collapse network round trips or prove better performance than Medusa.

The current relational store groups compatible writes. The pinned experimental
Drizzle repository updates individual rows in a loop, so batching is a concrete
opportunity against that path. It is not a general benchmark against every
Medusa persistence implementation. Flarex also performs catalog/integrity reads,
captures facts and stores recovery evidence; small operations may cost more.

Useful later measurements are SQL statement and network round-trip counts,
transaction/commit counts, rows read, write amplification, latency distribution,
retry rate and throughput under contention. Compare identical business inputs,
outputs, constraints and delivery guarantees on the same database environment.

Potential improvements include batched writes/relations, correct command-local
data reuse, fewer repeated checks supported by authenticated evidence, and
fewer independent commits where semantics permit. Never cache across writes
without invalidation or omit checks just to improve a benchmark.

Slow PGlite/Postgres tests are an observed issue, not hypothetical premature
optimization. Measure fixture installation separately from command execution;
reuse installed fixtures where isolation and lifecycle contracts permit.
PGlite evidence does not replace ordinary-role PostgreSQL concurrency proof.
