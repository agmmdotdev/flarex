# Roadmap 04: Private Task System API And Postgres

## Status

**Status:** Active. DTE-IP01 and DTE04-A1 through DTE04-A3 are complete. The
storage-neutral input-reference and run-creation contract, lifecycle JSON
envelope and pure relational projection, canonical Standard Application task
catalog, immutable runtime binding, and creation-authority receipt are
implemented. The five-table Drizzle schema, generated migration, relational
constraints, due-work index, and PGlite/real-Postgres migration proofs are also
implemented. DTE04-B now has a scope-bound lifecycle adapter, transaction/error
mapping, connected PGlite lifecycle/rollback/corruption proofs, a near-complete
canonical compatibility lane, and focused real-Postgres same-run serialization
plus post-lock database-time proof. The pure oracle still covers all 65 vectors;
61 transition-derived histories now execute through the concrete adapter, two
invalid commands remain at their decoder boundary, and two histories remain open:
one non-transition cursor and one explicit overflow-corruption setup. Canonical
multi-attempt histories, including OOM escalation, attempt exhaustion, and stale
attempt/fence outcomes, now execute through the adapter. Creation,
discovery, effect delivery, host, queue, and activation changes remain
unauthorized.

Roadmap 04 owns the first durable storage implementation for the admitted
run-attempt domain. Its purpose is to connect the existing scope-bound
`TaskSystemRunAttemptStore` contract to Flarex Postgres through Drizzle while
preserving the lifecycle semantics and reuse evidence already closed by
Roadmaps 01 through 03.

The audit originally found that canonical task definition/runtime binding and
task-input reference owners were documentation-only. DTE04-A1 therefore
stopped after the domain-owned JSON envelope and pure lifecycle projection.
DTE04-A2a and DTE04-A2b close those upstream contracts without inventing them
in persistence. DTE04-A3 landed the admitted five-table physical model. The
current DTE04-B slice adds only the private store adapter over that model and
still enables no backend or production runtime path.

## Outcome

Deliver a private, production-inert persistence slice that can:

1. create one idempotent run from trusted, immutable Flarex task-definition
   and scope authority;
2. inspect and transact that run through the already-shipped
   `TaskSystemRunAttemptStore` port;
3. persist the aggregate, accepted evidence, and ordered requested effects in
   one atomic transaction;
4. discover bounded due work without making a queue authoritative; and
5. prove the same contract on PGlite and real Postgres before any Cloudflare
   wake or host integration begins.

This is a persistence and private-system-API roadmap. It is not a public SDK,
execution host, scheduler, observability API, or production rollout roadmap.

## Current Baseline

DTE-IP01 already supplies:

- a private `@flarex/durable-task` package;
- the closed five-phase `TaskRunAttemptAggregateV1`;
- pure run-attempt decisions and exact lifecycle receipts;
- `TaskSystemRunAttemptStore` with only `transactRunAttempt` and
  `inspectRunAttempt`;
- typed decision, unavailable, corruption, stale-authority, transient-store,
  and terminal-store errors;
- an Effect service and Layer boundary whose store is dynamically selected and
  scope-bound; and
- 65 canonical compatibility vectors plus 37 named Trigger-to-Flarex
  divergences.

DTE04-A1 now additionally supplies:

- independently versioned JSON-safe aggregate and requested-effect envelopes;
- canonical decimal bigint preservation and Schema-position-owned canonical
  base64url byte wrappers;
- trap-safe, single-read hostile-input capture with global canonical-byte and
  nesting limits;
- one pure `TaskRunAttemptPersistenceProjectionV1` covering all five phases;
- the admitted `flarex-protocol/json` dependency while the boundary checker
  continues to reject every other protocol subpath; and
- hostile codec, ownership, size, proxy, depth, and five-phase projection
  tests.

A concrete, production-inert store adapter now exists in
`taskSystemRunAttemptStoreV1.ts`. Its factory accepts one already-resolved
`LocatedTrustedScopeAuthority`, captures the authority and target, and returns
one scope-bound `TaskSystemRunAttemptStore` value. PGlite and Postgres expose
only their corresponding located-target constructors and store factory; no
caller-selectable scope enters a lifecycle request. There is still no
run-creation API, due-discovery query, requested-effect delivery operation, or
production composition.

`@flarex/persistence-postgres` already owns the repository's Drizzle schema,
migrations, PGlite and `pg` construction, scope authority, transaction
helpers, driver-result normalization, JSONB policy, and paired persistence
tests. Roadmap 04 must use those owners rather than introduce a second database
package or an Effect-SQL stack with incompatible versions.

## Authority Boundary

The ownership split is fixed:

| Concern | Owner |
| --- | --- |
| Legal lifecycle states, transitions, replay, evidence, and effect ordering | `@flarex/durable-task` |
| Private run creation and due-discovery domain contracts | Roadmap 04, with identity changes reopening DTE02 |
| Drizzle tables, row codecs, SQL, locking, migrations, and driver failure mapping | `@flarex/persistence-postgres` |
| Tenant, deployment, active revision, located scope, and capability resolution | Flarex control-plane/backend owners |
| Queue publication, alarms, cron, and missed-wakeup recovery host | Roadmap 05 |
| Attempt compute and restricted user-code execution | Roadmap 06 |
| Authenticated query/live/stream APIs and UI projections | Roadmap 07 |

The persistence adapter captures a trusted, already-resolved scope capability.
Commands contain a run ID, never a tenant ID, scope ID, physical locator, raw
database handle, or authorization claim. Every table key and query predicate is
scope-qualified, but missing and cross-scope state share the same
non-disclosing unavailable result.

The adapter is operation-scoped or otherwise bound to one located scope. It is
not a process-wide `Context.Service` carrying a caller-selectable scope string.

## Reuse Decision

Trigger.dev remains a compatibility source and test oracle, not a runtime
dependency. Roadmap 04 reuses or adapts:

- transaction atomicity expectations for a run and its co-resident records;
- idempotent creation and read-after-write scenarios;
- bounded grouped-read and discovery lessons;
- duplicate delivery, replica lag, mixed-residency, and uncertain-response
  hostile cases where their semantics apply; and
- the rule that lifecycle writes must not escape the transaction selected for
  the owning run.

It does not adopt:

- Trigger's broad Prisma-shaped `RunStore` or generated clients;
- organization, project, runtime-environment, deployment, billing, or product
  foreign keys;
- legacy/dedicated dual-schema routing, cross-database residency, or a
  compatibility read replica;
- Redis coordination, waitpoint tables, batch topology, snapshots, or every
  Trigger run relation; or
- Trigger error classes as Flarex public or domain errors.

The detailed symbol/path ledger and disposition are in
[`preflight/19-roadmap04-source-and-existing-persistence-inventory.md`](./preflight/19-roadmap04-source-and-existing-persistence-inventory.md).

## Candidate Private Operations

Roadmap 04 introduces no generic repository. The candidate private surface is
split by semantic authority:

1. the existing `TaskSystemRunAttemptStore` remains exactly two operations for
   lifecycle mutation and inspection;
2. a separate run-creation capability accepts a closed decoded request plus
   trusted immutable bindings and returns an idempotent creation receipt; and
3. a separate bounded discovery capability returns due-run receipts suitable
   for later wake delivery.

Creation and discovery must not be added to `TaskSystemRunAttemptStore` merely
because they use the same tables. If either operation changes a DTE02 identity,
authority, or creation contract, DTE02 reopens before code changes.

The first creation transaction constructs the sole legal initial aggregate:
`phase = ready`, `ready.kind = initial`, a database-derived creation/eligibility
time, immutable definition and policy bindings, no attempt or lifecycle
acceptance, and the exact admitted initial effect cursor/history. A caller
cannot submit an aggregate snapshot.

Discovery is a hint producer, not transition authority. It returns bounded,
scope-local candidates ordered by a stable cursor. Starting or expiring an
attempt still requires the lifecycle transaction to reload current state and
win under its version, fence, lease, and database-time rules.

## Storage Direction Under Preflight

The minimum complete physical model has five responsibilities:

- one immutable task-definition revision row containing the canonical
  definition/runtime binding;
- one authoritative run row containing the encoded aggregate, immutable
  creation receipt/input reference, and relational lifecycle projections;
- one scope-local creation-request row owning idempotency identity; and
- one immutable attempt-identity row for every accepted grant, providing
  scope-local collision and run/ordinal/fence correlation; and
- one append-only requested-effect row per `(scope, run, sequence)` committed
  in the same transaction as the accepted lifecycle state.

The relational columns are derived routing/index projections, not a second
lifecycle model. A write derives them from the validated aggregate. A load
decodes the aggregate and verifies every authority-bearing projection before
the domain decision runs. Contradiction is corruption; the adapter does not
repair, prefer one copy silently, or continue from a partial row.

An extra event, attempt, lease, or replay table is not admitted by analogy with
Trigger. It requires an independent query, retention, or integrity need that
cannot be satisfied by the aggregate and requested-effect ledger. Large input,
result, log, trace, stream, checkpoint, or artifact bodies remain references to
their owning stores, never inline task-state blobs.

The encoded aggregate is not automatically JSONB-safe. Preflight 20 closes a
domain-owned, versioned extended-JSON envelope: canonical bigint strings stay
strings and bytes use one exact tagged canonical base64url representation. The
Postgres adapter stores only the resulting decoded JSON value in JSONB. A
TypeScript `$type` or `JSON.stringify` is not validation or a codec.

## Transaction Contract Under Preflight

For a lifecycle mutation, the concrete adapter must preserve this order:

1. enter the captured located-scope transaction capability;
2. validate fresh scope clock/authority;
3. load and lock the scope-qualified run row;
4. obtain one authoritative database-time snapshot after any lock wait;
5. normalize the Drizzle driver result, decode an owned aggregate, and verify
   its relational projections;
6. allocate an attempt ID and fence only when the operation is
   `start_attempt`, without publishing an unused candidate;
7. invoke the pure `decide` callback with no I/O or user code;
8. on decision failure or `no_change`, perform no lifecycle/effect write;
9. on `commit`, revalidate the expected version, next version, aggregate,
   evidence, completion replay, and contiguous effect sequence;
10. update the run row and insert requested effects atomically; and
11. return detached, readonly domain receipts only after the transaction
    succeeds.

Only a bounded whole-transaction retry may reinvoke `decide`, and only for the
explicit SQL conflict classes admitted by Preflight 21. No helper may retry a
single statement inside a transaction or catch an unknown defect as an
ordinary transient failure.

Commit-response loss is resolved through the existing idempotent lifecycle
replay on a fresh operation. Roadmap 04 does not invent dual writes, a shadow
store, or a second acceptance table to guess whether a commit happened.

## Effect And Layer Direction

The durable-task service stays domain-first. The live Postgres adapter owns one
narrow foreign Promise/driver boundary and maps expected SQL failures into the
existing typed store errors. Unexpected causes remain defects.

The implementation must use the installed Effect v4 and Drizzle versions. It
must not import Effect v3 SQL packages, upgrade Effect incidentally, wrap every
Drizzle expression in separate `Effect.tryPromise`, or expose Promise/throwing
semantics above the adapter boundary.

Layer construction owns acquisition and release of database resources and
must preserve request, transaction, Worker, and scope lifetimes. A dynamically
located scope cannot be captured in a global singleton Layer. The exact
composition and failure map are closed in Preflight 21 before implementation.

## Implementation Checkpoints

Implementation is split into reviewable checkpoints after each owning gate is
admitted:

- **DTE04-A1 — lifecycle persistence values — complete:** domain-owned aggregate and
  requested-effect JSON envelopes plus pure relational projection and hostile
  round-trip/correlation tests; no persistence package or DDL change;
- **DTE04-A2a — input and creation domain contract — complete:** domain-owned immutable
  task-input reference, request key, canonical key/request digest preimages,
  stable creation receipt, and typed validation/conflict errors; no service,
  hashing, object-store, persistence, or DDL work;
- **DTE04-A2b — Standard Application definition authority — complete:** private
  canonical task catalog and `TaskIdV1`, application-revision task-binding
  frame, `TaskDefinitionRuntimeBindingV1`, creation-authority receipt,
  canonical preimages/digests, strict ownership/correlation tests, and exact
  boundary-gate updates; no registration, activation, persistence, or host
  change;
- **DTE04-A3 — schema — complete:** five scope-qualified Drizzle tables,
  generated migration, constraints, indexes, PGlite upgrade/rollback/replay
  proof, and real-Postgres migration/query-plan proof; no store adapter,
  creation, discovery, delivery, or host integration;
- **DTE04-B — lifecycle adapter — implementation in progress:** the
  scope-bound `TaskSystemRunAttemptStore` value, transaction/error mapping,
  aggregate-to-effect/attempt-ledger correlation, allocation-free replay and
  current paths, connected PGlite lifecycle/error matrix, and focused
  real-Postgres lock/time/concurrency proof are implemented. The reusable
  compatibility harness now drives 61 transition-derived vectors
  through the concrete PGlite adapter while retaining two invalid command
  shapes at their pre-store decoder boundary. The remaining two vectors need
  a non-transition cursor fixture or explicit overflow-corruption setup
  before the 65-vector gate and final admission review can close;
- **DTE04-C — creation:** closed creation contract, initial aggregate builder,
  idempotency conflict semantics, and immutable binding checks;
- **DTE04-D — discovery and effect ledger:** bounded stable discovery plus
  atomic requested-effect persistence/read contracts, without delivery;
- **DTE04-E — real Postgres parity:** race, locking, rollback, uncertain
  response, migration, and query-plan proof; and
- **DTE04-F — final admission:** source map/notice refresh, boundary and bundle
  checks, broad validation, reviewers, and an explicit admit/revise receipt.

Each code checkpoint is a significant schema or behavioral change and requires
both standing reviewer subagents before commit under `AGENTS.md`.

## Admission Gates

Roadmap 04 cannot reach **complete: admit** until all of these are true:

- Preflights 19 through 22 contain no unresolved authority or representation
  decision required by the checkpoint being implemented;
- no active package imports Trigger source, Trigger packages, Prisma, or a
  `third_party` path;
- the migration is generated and checked through the existing persistence
  owner and works from an empty database and the previous committed journal;
- PGlite and real Postgres pass the same contract matrix, with engine-specific
  tests for locking and concurrency;
- all 65 lifecycle vectors execute through the concrete store with the same
  normalized receipts or a newly approved named divergence;
- cross-scope access, malformed rows, projection disagreement, counter
  exhaustion, duplicate effect insertion, transaction rollback, and stale
  authority fail closed;
- due discovery is bounded, stably ordered, indexed, and never acts as an
  accepted transition;
- no queue, host route, runtime dispatch, public export, or activation is
  enabled; and
- required provenance, license, typecheck, tests, boundary checks, and final
  reviewers pass against the final diff.

## Stop Boundary

Roadmap 04 must stop before:

- publishing or consuming a Cloudflare Queue message;
- delivering a requested effect;
- executing user task code;
- adding an authenticated HTTP, live, SSE, or WebSocket API;
- exposing task operations from the public `flarex` package;
- altering existing application-row OCC, commit, journal, feed, outcome, or
  outbox semantics;
- merging the Trigger workspace or lockfile; or
- enabling production routing, fallback, shadow execution, or dual writes.

## Reopening Rules

Reopen DTE01 for a new Trigger source dependency or reuse category. Reopen
DTE02 for identity, scope, definition binding, creation authority, or command
shape changes. Reopen DTE03 for lifecycle state, decision, receipt, evidence,
effect, or error changes. A persistence concern that cannot fit those admitted
contracts is not permission to work around them in SQL.

Roadmaps 05 through 07 remain the owners for delivery/scheduling, compute, and
web observability respectively.

## Preflight Set

- [`preflight/19-roadmap04-source-and-existing-persistence-inventory.md`](./preflight/19-roadmap04-source-and-existing-persistence-inventory.md)
- [`preflight/20-task-system-storage-and-schema-contract.md`](./preflight/20-task-system-storage-and-schema-contract.md)
- [`preflight/21-transaction-idempotency-and-effect-order.md`](./preflight/21-transaction-idempotency-and-effect-order.md)
- [`preflight/22-pglite-postgres-parity-and-admission.md`](./preflight/22-pglite-postgres-parity-and-admission.md)
- [`preflight/23-run-creation-domain-contract.md`](./preflight/23-run-creation-domain-contract.md)
- [`preflight/24-standard-application-task-definition-contract.md`](./preflight/24-standard-application-task-definition-contract.md)
