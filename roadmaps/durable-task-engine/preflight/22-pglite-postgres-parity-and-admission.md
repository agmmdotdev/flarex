# DTE04-P22: PGlite, Postgres, And Admission Proof

## Status

**Status:** Draft validation gate. This file defines the proof required before
Roadmap 04 implementation can be admitted; passing a PGlite happy path alone is
explicitly insufficient.

## Objective

Prove that the private Task System schema and adapter preserve the same domain
contract on the fast PGlite lane and the production real-Postgres lane, while
testing engine-specific locking, failure, migration, and query-plan behavior in
the environment that actually owns it.

## Validation Layers

### Pure Contract Lane

Run without a database:

- persistence-envelope encode/decode round trips;
- malformed/oversized/unknown-version envelope rejection;
- aggregate-to-projection derivation and correlation;
- creation digest and initial-aggregate construction;
- SQL-state/failure classification as pure data where possible; and
- source-map and provenance validation.

Property/hostile values must cover Postgres bigint boundaries, JavaScript safe
integer time boundaries, null/omission distinctions, 32-byte digests, unknown
keys, oversized payloads, and projection contradictions.

### PGlite Contract Lane

PGlite supplies fast deterministic coverage for:

- empty and incremental migration application;
- schema constraints and indexes visible through catalog inspection;
- run creation, exact replay, and conflicting replay;
- all lifecycle operations through the concrete
  `TaskSystemRunAttemptStore`;
- atomic aggregate/effect commit and rollback;
- inspection and corruption failures;
- bounded due discovery and cursor pagination;
- duplicate effect uniqueness; and
- all 65 canonical DTE03-F lifecycle vectors through persistence.

The PGlite harness must call the same adapter contract as Postgres. It may vary
only resource construction and engine-specific test controls; it must not use a
second repository implementation or weakened SQL.

### Real Postgres Contract Lane

Real Postgres repeats the shared contract and exclusively owns proof for:

- simultaneous writers on one run;
- row-lock or serializable isolation behavior;
- SQL-state classification for serialization/deadlock/constraint failures;
- transaction retry and callback reinvocation;
- connection loss and commit-response uncertainty harnesses where feasible;
- writer/read-after-write authority;
- migration from the previous committed journal;
- index selection and bounded query plans; and
- pool/transaction acquisition, release, cancellation, and timeout behavior.

Real Postgres tests use the repository's existing file-scoped fixture and
environment gating. They must not silently skip while the final admission
receipt claims parity.

## Shared Behavioral Matrix

| Scenario | Pure | PGlite | Postgres |
| --- | ---: | ---: | ---: |
| valid envelope round trip and ownership | yes | sampled | sampled |
| malformed aggregate/projection rejection | yes | yes | yes |
| idempotent first run creation replay | digest | yes | yes |
| conflicting creation identity | digest | yes | concurrent |
| initial aggregate exact legal state | yes | yes | yes |
| start attempt and atomic dispatch intent | decision | yes | concurrent |
| attempt-ID collision rollback/new candidate | allocation | yes | concurrent |
| duplicate start/current outcome | decision | yes | concurrent |
| heartbeat duplicate and stale fence | decision | yes | concurrent |
| completion replay after response loss | decision | yes | concurrent |
| completion versus lease expiry winner | decision | interleaved | simultaneous |
| cancellation versus completion winner | decision | interleaved | simultaneous |
| transaction rollback leaves no effect gap | n/a | yes | yes |
| requested-effect uniqueness/order | yes | yes | concurrent |
| cross-scope non-disclosure | n/a | yes | yes |
| stale scope authority | classification | yes | yes |
| database-time source and exact milliseconds | codec | yes | yes |
| bounded stable due pagination | order | yes | plan + race |
| migration empty/upgrade | n/a | yes | yes |

Every DTE03-F vector must retain the same normalized receipt. A changed receipt
requires a named divergence and the owning DTE preflight to reopen; a database
adapter is not allowed to redefine lifecycle behavior.

## Race Proofs

The real-Postgres harness must synchronize transactions deliberately rather
than rely on timing sleeps. At minimum it proves:

1. two `start_attempt` calls cannot both commit different grants from one run
   version;
2. heartbeat and completion cannot both advance from an incompatible basis;
3. completion and lease expiry produce one admitted winner and a correct
   idempotent/current loser receipt;
4. two first creation writers with the same key/digest return one run;
5. two first creation writers with the same key/different digest create at most
   one run and return one typed conflict;
6. requested-effect sequences remain gap-free for committed transitions and
   absent for rolled-back transitions; and
7. a whole-transaction retry may reinvoke the pure decision but never publish
   an unused candidate or duplicate effect.

Use barriers, held locks, or controllable driver seams. A test that "usually
races" is not an admission proof.

## Uncertain Outcome Proofs

Exact network-level commit ambiguity may require a focused driver seam. The
minimum proof is:

- the first operation commits aggregate plus effects but its receipt is hidden
  from the caller;
- the caller reacquires authority and submits the identical command;
- the store returns the exact idempotent accepted receipt and performs no new
  write; and
- the same pattern holds for run creation through its idempotency identity.

Do not simulate uncertainty by throwing before commit and claim it proves an
after-commit case. If the real driver cannot deterministically inject the
boundary, create a narrow test-only transaction result seam with no production
fallback behavior.

## Migration Proof

DTE04-A3 must produce evidence for:

- `drizzle-kit check` on the complete existing tree;
- migration from an empty PGlite database;
- migration from the immediately prior committed journal/snapshot;
- the same upgrade on real Postgres;
- exact columns, constraints, foreign keys, and indexes; and
- no modification or backfill of existing OCC, commit, journal, outbox, or
  application-row tables.

Tests must resolve the bundled migration folder through the persistence owner,
not `process.cwd()`.

## Discovery Query Proof

The first discovery query must have:

- a hard limit accepted only inside an admitted bounded range;
- scope and due-kind predicates;
- due-time ceiling;
- stable `(due time, run ID)` order and cursor semantics;
- no unbounded relation hydration or per-row follow-up query;
- compiled-SQL observation in tests; and
- real-Postgres `EXPLAIN` evidence using the intended index for representative
  cardinality.

Duplicate/stale results are correct because discovery is not a transition. A
corrupt due row fails the operation; it is not silently skipped into starvation.

## Performance And Boundaries

Before final admission, record bounded evidence for:

- maximum aggregate/envelope and requested-effect payload bytes;
- maximum effects per accepted transition as already constrained by the domain;
- discovery page maximum;
- query count per lifecycle operation;
- no N+1 lookup or unbounded scan;
- transaction duration excluding user/external I/O; and
- Worker/backend bundle exclusion from Trigger, Prisma, and Node-only packages
  outside their approved host boundary.

This roadmap does not require production-scale benchmarking, but it must reject
an obviously unbounded or sequential full-scope design.

## Checkpoint Validation

### DTE04-A1

- durable-task package typecheck and focused extended-JSON codec tests;
- pure lifecycle projection/correlation tests across all five phases;
- hostile byte-tag, base64url, bigint, unknown-key, aliasing, cycle, and size
  cases;
- no persistence package, schema, migration, host-runtime, or activation
  change; the only new domain dependency is the admitted
  `flarex-protocol/json` subpath; and
- main-thread diff audit plus both required reviewers before commit.

Receipt (2026-08-04): the durable-task package typecheck and all 41 package
tests pass, including 12 focused persistence codec/projection tests. The
source-map, 65-vector lifecycle, and narrow Trigger compatibility boundary
checks pass. Hostile coverage includes accessor/cycle/prototype rejection,
canonical base64url, byte ownership, distinct size ceilings, stateful proxies,
globally oversized nested containers, and deep object/array rejection. Both
required final reviewers reported no remaining finding after the accepted
fixes. DTE04-A1 is complete; this receipt does not open DTE04-A3 or any
concrete adapter.

### DTE04-A2/A3

- canonical task-definition, creation-receipt, input-reference, request, and
  conflict codec tests in their proper owners;
- package typecheck and focused schema tests;
- PGlite migration tests;
- real-Postgres migration/schema tests;
- Drizzle schema check; and
- main-thread diff audit plus both required reviewers before commit.

### DTE04-B

- all concrete-store lifecycle tests on PGlite;
- focused real-Postgres transaction/race tests;
- all store-addressable cases in the 65-vector compatibility lane through the
  adapter, with invalid command shapes retained at their pre-store decoder
  boundary;
- Effect boundary/type/error tests; and
- both required reviewers against the final diff.

DTE04-B currently includes the scope-bound adapter, connected PGlite lifecycle
and error coverage, a near-complete canonical lane, and a real-Postgres
lock/time/concurrency proof. The pure oracle covers all 65 vectors; 61
transition-derived histories execute through the concrete adapter and two
invalid commands execute at their decoder boundary. The history seeder consumes
only committed decision outputs and proves that the final transition equals the
stored aggregate; it does not infer ledger rows from the aggregate. Canonical
multi-attempt fixtures now derive their run, lease, and effect counters through
real starts, heartbeats, failed completions, and lease expiry. In particular, a
late attempt-one completion reaches `stale_attempt` through lease-loss retry so
there is no earlier completion identity to conflict with. The remaining two
histories need a non-transition cursor fixture or explicit overflow-corruption
setup before the full gate and final reviewers can close. This
checkpoint is not yet a DTE04-B admission receipt.

### DTE04-C/D

- creation concurrency/idempotency/conflict matrix;
- discovery boundedness/query-plan tests;
- requested-effect atomicity/order tests;
- cross-scope and stale-authority hostile cases; and
- both required reviewers after final fixes.

### DTE04-E/F

- complete PGlite and Postgres package suites relevant to the touched owner;
- root typecheck/boundary/provenance/source-map gates;
- package/bundle checks proving no source-island/Prisma dependency;
- migration journal verification;
- final TypeScript/Effect and code-quality reviewers on the unchanged final
  diff; and
- a final `admit` or `revise` receipt with exact command/test counts.

## Admission Decision

Roadmap 04 may become **complete: admit** only when:

1. Preflight 20 has no blocking representation/schema or upstream
   definition/input decision for the checkpoint being admitted;
2. Preflight 21 has no blocking transaction/clock/retry/composition decision;
3. PGlite and real Postgres pass the shared matrix;
4. real Postgres passes every required race and plan proof;
5. all canonical lifecycle vectors preserve their receipts;
6. creation and lifecycle uncertainty recover idempotently;
7. source map, notice, workspace, package, and bundle boundaries pass;
8. reviewers report no unresolved actionable finding; and
9. the implementation remains production-inert.

If a difference is an engine limitation, the decision is not automatically to
weaken Postgres semantics to PGlite. Keep shared SQL where correct, isolate the
test limitation explicitly, and require the production contract to be proven
on real Postgres.

## Stop Boundary

Even after admission, the adapter is not permission to:

- publish a queue message or deliver requested effects;
- run a scheduler, alarm, cron, or Durable Object;
- execute user task code;
- expose web/API/live/UI task surfaces;
- add public SDK exports; or
- route production traffic.

Those remain Roadmaps 05 through 10.
