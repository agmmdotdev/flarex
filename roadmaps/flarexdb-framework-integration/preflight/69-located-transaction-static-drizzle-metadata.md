# Located Transaction Static Drizzle Metadata

Status: proposed shared-owner performance correction; implementation awaits approval.

## Outcome And Evidence

Remove repeated compilation of the checked-in Drizzle schema when the located
PostgreSQL transaction runner constructs a view of an already-acquired client.
The nearest complete consumer proof is the existing ordinary-role PostgreSQL
Payload Local API latency benchmark. This is not a Payload adapter change.

The accepted database design and package-boundary roadmap retain Postgres and
the trusted transaction owners as authority. Records 64, 65 and 67 retain fresh
Application and installation acceptance. Their validation is not the proposed
removal target.

An isolated warmed diagnostic of actual `host.read(commands.findByID, ...)`
shows both substantial query completion time and work outside those queries.
The CPU stack identifies `createConnectedDatabase` in
`packages/persistence-postgres/src/postgresLocatedReadCommitted.ts`, through
Drizzle's `construct` and `extractTablesRelationalConfig`. Installed Drizzle
0.45.2 recompiles the supplied full schema on every `drizzle(client, { schema })`
call. Its native transaction constructor already reuses the extracted schema.

The repository already owns a matching resource-free factory in
`src/physicalSession/drizzle.ts`: `makePhysicalSessionAccess` extracts static
metadata once and constructs fresh client-bound database/transaction views.
Relational sessions and artifact-control sessions use it today. The located
runner still calls the full Drizzle constructor on pool checkout; its connected
Client variant constructs once per runner rather than once per operation.

The diagnostic used the real fixture and Local API, ten warmup reads and eighty
reads of a fixed document, with preferences enabled. One run sampled the Node
CPU stack; another disabled CPU sampling and timed `pg.Query.submit` through
`end`, asserting no overlapping queries and the exact returned document.
Raw local summaries are in
`work/validation/payload-runtime-profile/attribution.json`; numerical receipts
belong in Git. Temporary test instrumentation was removed after investigation.

Query completion includes protocol/transport, server work, row parsing and
scheduling; it excludes earlier SQL construction and pool acquisition. Time
outside queries is not a pure CPU measurement. Sampling has overhead and its
inclusive ancestors overlap. This fixed-read diagnostic is not the original
tombstone-growing operation matrix and is not a before/after speedup result.

## Proposed Scope And Owners

Reuse the existing static-metadata construction owner, rather than introducing
a second cache or modifying Payload. The candidate source scope is
`src/physicalSession/drizzle.ts` and `src/postgresLocatedReadCommitted.ts`, with
their connected tests. Accommodate a borrowed `Client` as well as `PoolClient`
only through the actual common node-postgres contract; neither view factory
acquires, releases, quarantines or settles a client.

Retain the located runner's existing `database.transaction(...)` boundary and
READ COMMITTED configuration. Do not substitute the factory's bare transaction
view for Drizzle's transaction callback, create another transaction, or migrate
the runner to the physical-session lifecycle driver as part of this slice.

- Extend: the existing static Drizzle metadata factory only as needed for both
  borrowed-client types, keeping it private and resource-free.
- Replace/delete: full-schema recompilation in the located runner, and its
  redundant view-construction wrappers if no longer needed.
- Retain: fresh client-bound sessions, schema/table identity, typed query and
  relational-query behavior, pool checkout/release, connected-client queueing,
  rollback, exact callback failure provenance, quarantine, cancellation and
  uncertain settlement classification.
- Defer: other full-schema constructors outside this measured owner; prepared
  SQL statement caching; query batching; manifest/JSON codec optimization;
  dependency upgrades; and the independent installation-history investigation.
- Reject: caching rows, catalogs or authority, eliminating fresh accepting
  checks, changing locks/deadlines, raw SQL bypasses, and adapter-local workarounds.

Only immutable code-defined ORM metadata is shared. No client, database view,
transaction, authorization verdict or restored catalog becomes cross-request
state. Check which public constructor conveniences the actual caller consumes;
do not assume the internal database constructor has every property of `drizzle`.

## Validation And Completion Gates

Before retaining a candidate, compare it with frozen current source using the
unchanged opt-in Payload operation matrix, serialized ordinary-role PostgreSQL
runs, and repeated baseline/candidate pairs. Report untraced p50/p95, unchanged
SQL counts and construction separately. Require reproducible complete-request
improvement, not a favorable CPU sample. Remove the candidate if that gate fails.

Add deterministic evidence that static extraction is not repeated per client,
while fresh views route to their exact clients and preserve typed SQL/relational
queries. Retain the existing located settlement and physical-session fault tests;
prove pool and connected-client behavior, rollback, cleanup failure, queueing,
quarantine and uncertain settlement through the existing owner tests.

Run focused PGlite consumer regressions and ordinary-role PostgreSQL owner and
Payload regressions, including catalog-integrity refusal and relation readiness.
PGlite proves unchanged consumer behavior, not the node-postgres constructor.
Exercise the connected Commerce and combined-command consumers proportionally.
Run affected typechecks, core/diff/staged lint and both project reviewers on the
final owned diff. Preserve unrelated Medusa work, remove temporary diagnostics,
stop owned database resources and commit only a completed verified correction.
