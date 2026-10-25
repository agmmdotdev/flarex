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

All Task-owned database state moves to private Flarex logical schemas over
shared Postgres storage. This includes per-scope runs and platform-level Task
discovery, scheduler ownership and repair progress. **No current Task-specific
physical table is a permanent exception, and no replacement Task-specific
physical table set is the target.** General Flarex storage/catalog/settlement
tables serve all consumers and are outside this Task-only retirement.

The engine is host-neutral. Inject wake delivery, timer/repair triggers and
compute capabilities. Cloudflare is the first host; another host can implement
the same admitted contracts. The fork owns task policy, FlarexDB owns durable
truth, and host services wake or execute work.

## Reading Order

| Document | Owns |
| --- | --- |
| [Engine and integration](./01-engine-and-integration.md) | Adopted source, core feature scope, package boundaries and framework ownership |
| [Logical storage](./02-logical-storage.md) | Private schemas, per-scope and platform state, transaction and discovery guarantees |
| [Host adapters](./03-host-adapters.md) | Redis replacement, queues, timers, compute and host portability |
| [Cutover and retirement](./04-cutover-and-retirement.md) | Isolated proof, consumers, development-data disposition, complete physical retirement and validation |
| [Living roadmap](../../roadmaps/task-system/README.md) | Current baseline, open gates and implementation status |

## Target Shape

```text
Application / Payload / Medusa adapters
                    |
          private shared Task API
                    |
       independently maintained Trigger fork
              /                 \
  Flarex logical Task store     host capabilities
              |              /       |        \
   shared core transactions  wake    timer    compute
              |
           Postgres
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
