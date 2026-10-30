# Task System: Independent Trigger Fork

## Status And Authority

Status: **accepted replacement direction; implementation pending**. This folder
owns the Task architecture. The [Task roadmap](../../roadmaps/task-system/README.md)
owns implementation status and correctness gates. This documentation change
does not create packages, change runtime routing or reset a database.

Read this folder before using the older Task documents. It supersedes
[the earlier shared-task proposal](../flarexdb-shared-task-system.md),
[the custom-engine design](../flarex-durable-task-engine.md) and the direction,
backlog and admission prescriptions in
[`roadmaps/durable-task-engine/`](../../roadmaps/durable-task-engine/README.md),
including preflights 72 and 73. Those records are legacy baseline, source and
regression evidence. Their historical approval text does not authorize new work.
Existing behavior remains implemented until an explicit consumer cutover;
marking a document legacy does not revoke a supported caller's contract.

The [accepted database design](../flarex-db-accepted-design.md),
[shared logical storage](../flarexdb-shared-logical-storage.md) and
[package boundaries](../../roadmaps/16-package-boundaries.md) still govern general
authority. This folder makes the Task-specific replacement choices explicit.

## Decision

Adopt the required Trigger.dev engine source and tests once, then maintain an
independent Flarex fork. Preserve actual lifecycle methods and connected control
flow as the starting implementation. Freely change dependencies, types,
transactions and module structure to fit Flarex, and remove unused features.
Routine upstream synchronization, easy upstream merges, full Trigger product
compatibility and a retained-line percentage are not goals.

Do not implement another state machine from scratch after reading Trigger, or
wrap the current custom decisions in a new package. The current code is a
regression and integration baseline, not the new engine's implementation.

Use **Convex-style internal logical system tables for storage and the independent
Trigger fork for the engine**. The [storage reference](./02-logical-storage.md#convex-storage-reference)
records the inspected Convex mechanism and its limits. Convex supplies the
storage precedent; retained Trigger methods own Task lifecycle decisions.

All Task-owned database state moves to private Flarex logical schemas over
shared Postgres storage. Each app/environment execution scope has private Task
tables alongside its application/framework logical tables, installed and
controlled by the platform. This includes per-scope runs and platform-level Task
discovery, scheduler ownership and repair progress. **No current Task-specific
physical table is a permanent exception, and no replacement Task-specific
physical table set is the target.** General Flarex storage/catalog/settlement
tables serve all consumers and are outside this Task-only retirement.

Tasks reuse the [shared FlarexDB core's indexing and DO cache system](./02-logical-storage.md#shared-core-indexing-and-do-cache).
Task schemas declare their required logical indexes; core owners maintain and
query them. Eligible Task rows and index ranges use the same cache machinery
and Cloudflare DO adapter as other admitted core consumers. The Task store is
an integration adapter, not a separate database, index engine or cache layer.
Postgres remains authoritative; Task cache admission and writer integration
must be proved before activation.

Task schema installation and evolution use the
[shared schema lifecycle core](../flarexdb-shared-schema-lifecycle.md), alongside
Flarex apps, Payload and Medusa. The platform supplies private Task definitions
and version/conversion requirements; common core APIs own admission, planning,
builds, validation, progress/recovery, readiness and activation. Bootstrap uses
trusted system authority independently of app code deployment and Task execution.
There is no Task-specific installation or migration engine.

The engine is host-neutral. Inject wake delivery, timer/repair triggers and
compute capabilities. Cloudflare is the first host; another host can implement
the same admitted contracts. The fork owns task policy, FlarexDB owns durable
truth, and host services wake or execute work.

## Reading Order

| Document | Owns |
| --- | --- |
| [Engine and integration](./01-engine-and-integration.md) | Adopted source, core feature scope, package boundaries and framework ownership |
| [Logical storage](./02-logical-storage.md) | Convex source precedent, private system tables, shared core indexes/DO cache, per-scope and platform state, atomic enqueue and discovery guarantees |
| [Host adapters](./03-host-adapters.md) | Redis replacement, queues, timers, compute and host portability |
| [Cutover and retirement](./04-cutover-and-retirement.md) | Isolated proof, consumers, development-data disposition, complete physical retirement and validation |
| [Living roadmap](../../roadmaps/task-system/README.md) | Current baseline, open gates and implementation status |
| [Shared schema lifecycle](../flarexdb-shared-schema-lifecycle.md) | Core installation/evolution APIs shared by Application, Payload, Medusa and Tasks |

## Target Shape

```text
Application / Payload / Medusa adapters
                    |
          private shared Task API
                    |
       independently maintained Trigger fork
              /                 \
  Flarex Task store adapter     host capabilities
              |              /       |        \
   shared logical DB core    wake    timer    compute
   (rows, indexes, transactions, cache validity)
              /                    \
   shared DO cache adapter       Postgres
   (eligible read reuse)     (durable authority)
```

Keep Application OCC, native framework transactions and the trusted Task
transaction profile distinct. Sharing the engine or physical storage grants
neither direct lifecycle-write authority nor implicit cross-framework atomicity.
Native Medusa graph execution, step retry and compensation remain Medusa-owned.

## Current Versus Target

The current `@flarex/durable-task` custom lifecycle, Task-specific physical
tables and existing host integrations still serve their admitted private
consumers. Trusted workflow continuation/checkpoint work and the bounded native
inline Product import have landed; they are migration inputs, not hypothetical
future consumers. The new fork package and logical Task store do not exist yet.

Start with one new private `@flarex/trigger-run-engine` package. Leave existing
callers operational during the isolated proof. Each migrated capability must
retire its displaced implementation; the final outcome has one task lifecycle
owner and no permanent fallback, dual writes or retained physical Task schema.

## Decision Boundaries

- New Task work follows this folder and the current roadmap, not old DTE next
  steps. Necessary baseline fixes remain possible in their explicit task scope.
- Core scope checks, fencing, idempotency, publication and uncertain-outcome
  recovery remain required even when original Trigger method bodies change.
- No Prisma client, Redis client or Redlock enters the admitted fork runtime.
  The frozen source and isolated reference tests may retain those dependencies.
- The project is pre-production and targets clean replacement. Specify actual
  development stores and reset effects before deleting data; do not invent
  compatibility obligations or assume every accessible database is disposable.
- Public API expansion, hosted activation, additional clouds, arbitrary
  workflows and broad Trigger feature parity require their own scope.
