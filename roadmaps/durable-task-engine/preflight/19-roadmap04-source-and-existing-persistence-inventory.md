# DTE04-P19: Source And Existing Persistence Inventory

## Status

**Status:** Complete for roadmap planning. This inventory authorizes no code or
schema change. Re-run it at DTE04-F against the then-current pinned source and
persistence package.

## Question

Which Trigger.dev persistence behavior should Flarex reuse, which mechanics
must be translated behind Drizzle, and which Trigger product/database topology
must be discarded before Roadmap 04 can design a concrete store?

## Audited Baselines

The inventory uses:

- pinned Trigger.dev commit `f10bc23785e569e5d917318cf2033aabdbe96a0b`;
- `third_party/trigger.dev/upstream/internal-packages/run-store/src` as the
  primary Trigger persistence seam;
- the committed `@flarex/persistence-postgres` package rather than a speculative
  new persistence owner; and
- the shipped `@flarex/durable-task` DTE-IP01 contract as the target semantic
  boundary.

The Trigger source island remains excluded from the root workspace. File paths
below are evidence paths, not import paths.

## Trigger.dev Inventory

| Source | Observed responsibility | Flarex disposition |
| --- | --- | --- |
| `internal-packages/run-store/src/types.ts` `RunStore` | Broad Prisma-shaped create, lifecycle, waitpoint, batch, snapshot, and query API | Do not transplant. Use it to enumerate behavioral scenarios and transaction groupings. |
| `PostgresRunStore.ts` `runInTransaction` | Opens a transaction on the store that owns a run and requires inner writes to use that store/transaction | Reuse the atomicity invariant; translate through the captured Flarex scope transaction capability. |
| `PostgresRunStore.ts` `#withOptionalTransaction` | Keeps multi-row writes atomic and reuses an existing interactive transaction | Reuse the multi-write proof, not the optional raw-client API. Flarex never exposes a transaction to the domain service. |
| `PostgresRunStore.ts` `createRun` | Creates a run plus snapshot/associated waitpoint through Prisma relations | Reuse crash-atomic creation scenarios only. Replace the record topology with the closed Flarex initial aggregate and immutable definition binding. |
| `runOpsStore.ts` routing | Routes between legacy and dedicated databases by run residency | Discard. Flarex has one located scope authority and no Trigger dual-residency migration. |
| `runOpsStore.*idempotency*.test.ts` and `PostgresRunStore.findRunsByIdempotencyKeys.test.ts` | Duplicate, scope, and read-after-write cases | Adapt the hostile cases to scope-local Flarex creation idempotency and primary-authority reads. |
| `PostgresRunStore.writeAtomicity.test.ts` | Multi-row rollback expectations | Port the applicable atomicity scenarios to aggregate plus requested-effect rows. |
| `*.replicaLag.test.ts` | Documents failures caused by stale read views and cross-database routing | Preserve as negative evidence: first Task System reads use the captured primary/transaction, not an unproven replica. |
| `connectedRunsBounded*`, grouped-read tests | Requires bounded queries instead of unbounded fan-out | Reuse the boundedness principle for due discovery; do not import waitpoint graph contracts. |
| `crossGenerationError.test.ts` | Normalizes errors across generated Prisma client generations | Discard the Prisma class bridge. Replace it with one Postgres/Drizzle failure classifier owned by the adapter. |
| waitpoint, batch, snapshot, TTL, service, and mixed-residency tests | Trigger-specific run graph and product migration behavior | Exclude from Roadmap 04 unless a later roadmap explicitly admits the corresponding capability. |

## Why Trigger `RunStore` Is Not The Data Layer To Reuse Directly

Trigger.dev does have a data-access layer, but it is not storage-neutral. Its
public shape exposes Prisma input/select/include types, accepts Prisma clients
or transactions, models Trigger relations, and includes routing for two
database generations. Much core engine code calls that interface, which is
valuable evidence that behavior can be separated from direct Prisma calls, but
the interface itself still carries Trigger storage and product policy.

Flarex therefore reuses at three levels:

1. **behavior and invariants** — transaction grouping, idempotent replay,
   boundedness, read-after-write, and hostile failure scenarios;
2. **control-flow evidence** — which records must commit together and where a
   stale or duplicated delivery can occur; and
3. **tests/provenance** — adapted scenarios tied to the pinned upstream source.

It translates the adapter and rejects the API shape. Recreating all those
behaviors from memory would be an unnecessary reimplementation; importing the
Prisma API would surrender Flarex authority.

## Existing Flarex Persistence Inventory

| Existing owner/mechanic | Roadmap 04 use |
| --- | --- |
| `src/schema.ts` and the single Drizzle migration tree | Add admitted task tables here; do not create a second schema/migrator. |
| `src/postgres.ts` and `src/pglite.ts` | Compose the concrete adapter through both existing constructors after package dependency and Layer design are admitted. |
| `src/defaultMigrationsFolder.ts` | Reuse module-owned migration location; never resolve from arbitrary process cwd. |
| `src/driverExecuteResult.ts` | Reuse installed Drizzle `execute` result normalization for raw SQL. |
| `src/detachDriverRows.ts` | Reuse only for row shapes that satisfy its ownership contract; domain decoding and freezing remain task-owned. |
| `src/jsonbNotNullValue.ts` | Reuse only if the selected envelope needs its exact JSON-null semantics. It does not make an arbitrary aggregate JSON-safe. |
| `src/effectTransactionFailure.ts` | Assess for exact failure/cause mechanics; retain task-specific operation and typed error projection. |
| `src/postgresLocatedReadCommitted.ts` and transaction capability types | Reuse located-scope/transaction ownership where semantics match; lifecycle isolation/locking remains an explicit decision. |
| `src/scopeClock.ts` and scope-authority owners | Reuse trusted scope clock/authority mechanics rather than accepting caller time or scope. |
| `src/drizzleQueryObservation.ts` | Reuse test-only compiled-SQL observation mechanics for discovery/index proof without changing execution. |
| paired `*.test.ts` and `*.postgres.test.ts` harnesses | Follow the established PGlite/real-Postgres proof shape. |

The package already uses `bigint` in both number and bigint modes, JSONB with
explicit types/checks, scope-qualified keys, transaction helpers, outbox-like
tables, and real-Postgres concurrency tests. Those are implementation
primitives, not permission to copy a nearby domain's schema or failure policy.

## Target Contract Inventory

The shipped durable-task target is deliberately smaller than Trigger's store:

- `transactRunAttempt(request)` receives a pure `Result` decision callback;
- `inspectRunAttempt(request)` returns a decoded current snapshot;
- the callback receives database time, current aggregate, and an optional
  adapter-issued attempt candidate;
- `commit` carries the exact next aggregate, evidence, requested effects, and
  outcome;
- `no_change` writes nothing and returns an idempotent or current receipt; and
- all results are detached domain values with no SQL/Drizzle/client leakage.

Roadmap 04 must build to this surface. It must not widen it to accommodate a
convenient repository implementation.

## Reuse Classification

### Reuse With Minimal Semantic Change

- co-resident atomic write requirements;
- duplicate/idempotent operation cases;
- transaction rollback and response-loss scenarios;
- stable bounded query requirements;
- read-your-write/primary-authority requirements; and
- upstream provenance and license notices.

### Seam-Adapt

- Trigger run creation into Flarex initial-aggregate construction;
- Trigger run/attempt state transitions into the already-admitted pure decision
  seam;
- Trigger database-issued state into Flarex database time, ID, fence, version,
  and effect sequence contracts; and
- Trigger persistence tests into normalized Flarex receipts.

### Adapter-Translate

- Prisma transactions and generated queries into Drizzle/Postgres;
- Prisma constraints/errors into typed Flarex store errors;
- Trigger environment scoping into captured Flarex scope authority; and
- Trigger relational run topology into the aggregate/projection/effect model
  admitted by Preflight 20.

### Discard

- Trigger organization/project/environment ownership;
- legacy/dedicated database routing and mixed residency;
- generated Prisma types and client errors;
- read replicas without a fresh authority proof;
- waitpoint, batch, debounce, checkpoint, billing, alert, and service tables;
- Redis queue/lock/pub-sub authority; and
- public Trigger management/dashboard contracts.

## Required Source-Map Additions

Every implementation file adapted from a Trigger behavior must add or update a
source-map entry with:

- the pinned upstream file and relevant symbol/test;
- the Flarex target file and owner;
- reuse class: `unchanged`, `seam-adapted`, `adapter-translated`, or
  `discarded`;
- exact semantic differences, especially scope and transaction authority;
- retained/adapted tests; and
- notice/license applicability.

Pure Flarex database mechanics that have no upstream code origin must say so;
they must not be falsely labelled as copied Trigger source.

## Closed Findings

1. There is a useful Trigger persistence layer, but it is Prisma/product-shaped
   and cannot be the Flarex domain port.
2. The shipped `TaskSystemRunAttemptStore` is the correct lifecycle boundary;
   it is narrower than Trigger's `RunStore` by design.
3. `@flarex/persistence-postgres` is the sole concrete database owner for this
   roadmap.
4. Scope authority replaces Trigger organization/environment routing; it is
   not a field rename.
5. Trigger transaction, idempotency, bounded-read, replica-lag, and atomicity
   evidence must be ported where semantically applicable.
6. A new broad repository, Prisma compatibility facade, dual store, or source-
   island runtime dependency is rejected.

## Gate To Preflight 20

Preflight 20 may propose tables and codecs only within this inventory. Adding a
Trigger relation or a new persistence owner requires this inventory to reopen
with an explicit reuse and authority rationale.
