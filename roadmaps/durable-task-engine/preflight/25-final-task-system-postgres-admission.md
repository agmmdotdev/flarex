# DTE04-P25: Final Task System And Postgres Admission

## Decision

**Outcome: complete: admit.** Roadmap 04's private Task System domain,
scope-bound Drizzle schema and adapters, PGlite lane, and genuine PostgreSQL
lane satisfy the admitted lifecycle, creation, read, migration, provenance,
boundedness, and production-exclusion contracts.

This receipt does not authorize a queue, requested-effect delivery, scheduling,
host composition, HTTP or public API, observability surface, runtime dispatch,
or production activation. Those remain later-roadmap concerns.

## Admitted Surface

The admitted production-inert surface is limited to:

- the private `@flarex/durable-task` run-attempt, creation, and read contracts;
- the five scope-qualified Task System tables and generated Drizzle migration;
- scope-bound lifecycle, creation, due-discovery, and requested-effect snapshot
  capabilities in `@flarex/persistence-postgres`;
- PGlite contract proofs and genuine PostgreSQL migration, plan, locking,
  concurrency, rollback, and uncertain-response proofs; and
- the pinned Trigger.dev source map, attribution notices, compatibility vectors,
  and active import/package/bundle exclusion gates.

Trigger.dev remains a source and compatibility oracle. Prisma, Trigger runtime
packages, and the independent Trigger workspace/lockfile are not runtime
dependencies of the admitted Flarex packages.

## Boundedness Receipt

The admitted design has explicit finite ceilings:

- persisted run-attempt aggregate JSON: `1,048,576` UTF-8 bytes;
- persisted requested-effect JSON: `65,536` UTF-8 bytes per effect;
- canonical run input: `33,554,432` bytes;
- requested effects per accepted lifecycle mutation: `5`;
- attempts per run and retained completion replays: `250` each; and
- due-discovery and requested-effect page size: `100` rows.

One lifecycle transaction execution issues five fixed reads when the aggregate
has no acceptance effects to correlate and six when it does: scope authority,
run aggregate, database time, optional bulk requested-effect correlation,
attempt identities, and dispatch-effect identities. A current/idempotent result
adds no write. An accepted non-start mutation adds one aggregate update and one
bulk effect insert; an accepted start adds one more attempt-identity insert.
The maximum is therefore nine application SQL statements per execution and 27
across the hard three-execution transaction retry ceiling, excluding driver
transaction-control statements.

There is no per-row follow-up query. Requested effects are correlated in one
bounded `IN` query. Attempt identities and dispatch effects are loaded in two
bulk queries and cannot exceed the domain/database attempt ceiling of 250.
Discovery is a single keyset query with a validated page limit and stable
database-issued ceiling. Requested-effect reads are a single bounded sequence
query after one run-locked snapshot ceiling is established.

Transactions contain only SQL plus synchronous identity allocation and pure
decode, decision, projection, correlation, and encode work. The decision port
returns a synchronous `Result`; it cannot await user or external I/O inside the
transaction. Queue publication, effect delivery, Worker calls, and HTTP calls
do not exist in this admitted surface.

## Validation Gate

The admitted package, migration, PGlite, genuine PostgreSQL, workspace
typecheck, lifecycle compatibility, provenance, boundary, and focused broad
regression gates pass. Genuine PostgreSQL execution remains fail-closed when an
authenticated connection is absent. The migration and connected parity lanes
must remain non-skipped whenever a later roadmap relies on this admission.

The durable-task source-map check validates the package file list, copied
licenses, attribution notice, pinned source metadata, exact mapped headers, and
target hashes. The Trigger compatibility boundary rejects active Trigger,
Prisma, forbidden internal package, source-island, and premature host imports
across production workspace code. Together with workspace typechecking and the
package manifests, these gates prove that the admitted code remains
production-inert and does not pull the Trigger island or Node-only tooling into
a Worker/backend runtime bundle.

## Handoff

Roadmap 04 is closed. The next discussion may create
`05-cloudflare-wake-and-scheduling.md` as a docs-first roadmap for queues,
alarms, missed-wakeup recovery, duplicate delivery, bounded scheduling, and
fail-closed activation. This receipt grants no implementation authority to that
candidate roadmap.

Roadmap 07 remains the separate owner for authenticated observability query and
command APIs, run-state subscriptions, task-output streams, retention/privacy,
and dashboard consumption. Live projections must never become run-transition
authority.
