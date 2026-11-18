# Bounded observation composition

Status: implemented, validated and measured as a bounded experiment. Performance
promotion remains closed. No production routes or active adapters change.

## Hypothesis and ownership

The prior compiled-plan slice reduced construction time but retained 88 / 37 /
59 PostgreSQL exchanges for complete Payload CRUD / Product / mixed requests.
Compose adjacent trusted observations into fewer statements while preserving the
same locks, evidence, failure order and fresh data snapshots. Native callbacks,
commands and profiles keep their existing lifetimes.

| Operation | Previous | Replacement |
| --- | --- | --- |
| Reservation authority and selected definitions | Two locking statements | One compiled authority/selection guard; reservation INSERT remains separate |
| Accepting authority, selection and command | Three locking statements | One compiled guard with command UPDATE lock; scope-clock acquisition remains separate |
| Framework/mixed acceptance evidence | Current rows, identity history, equality invalidations, optional point/range invalidations | One scalar verdict containing the required bounded probes after the scope clock and deadline check |
| Standalone Application acceptance evidence | Separate point and range invalidation queries | One ordered verdict after its existing scope-clock/deadline checks |

`read-guards.ts` owns locking query construction and immutable plans. Its new
accepting cache is separate from read guards, bounded to 32 plans per facade
(four caches, at most 128 plans). Every execution binds a fresh scope/command and
reacquires locks. `persistence.ts` retains opaque issuance, binding validation,
reservation, recovery and lifetime policy. The combined accepting guard does not
perform the deadline check early: it remains after scope-clock acquisition.

`write-conflicts.ts`, `equality-storage.ts` and `application-conflicts.ts` lower
their own evidence to nullable SQL verdicts. `settlement-observations.ts` composes
them through PostgreSQL COALESCE, preserving predecessor, equality, Application
point, range-admission and range-conflict precedence. Invalid metadata becomes a
verdict at its original position, rather than throwing during eager plan assembly.
There is no second TypeScript policy algorithm or generic query registry.

One internal ordering change is deliberate: malformed trusted-host selection
shape (duplicates or over 16 tables) now fails `unsupported` before database
authorization, as empty selections already did. It reveals no database state and
issues no command or native callback capability. For admitted shapes, authority
denial still precedes selected-version denial. Native error/callback ordering and
the settlement verdict precedence described above remain preserved.

The CAS probe uses a bounded Drizzle-built VALUES relation and null-safe revision
comparison. An inserted identity must still have no current row and no history,
including tombstones. History, equality and range probes retain their scope,
table, index, exact-key and sequence predicates. Only the final scalar verdict
crosses the client boundary; this is fewer exchanges, not fewer required checks.
Bounded input and scalar output do not prove constant physical planner work.

## Freshness, writers and failure barriers

The lock order remains authority/installation/grant, sorted selected definitions,
command, then scope clock. Installation/authorization/definition writers conflict
with their corresponding guard locks. Command mutation conflicts with its row
lock. Business publication and its document/history/index changes serialize under
the scope clock. The evidence query gets a fresh READ COMMITTED statement snapshot
after a clock wait. No SQL transaction spans a native callback or remote effect.

Current framework data reads still follow their read guard in a separate
statement. A guard-only CTE cannot make that statement's initial snapshot fresh
after a lock wait. This replacement therefore keeps those boundaries intact.
Application historical snapshots, exact dependencies, original/pending state,
fencing, retained history, unique constraints, atomic publication, cancellation,
rollback-only state and uncertain-result recovery remain required.

The new database witnesses exercise direct-versus-mixed point obligations,
deleted-identity history, overlapping failure precedence, accepting expiry after
authority/definition/command/clock waits, and a real writer held after all writes
but before COMMIT. Its contender must wait for the scope clock and observe the
new committed predecessor before publication. Existing owner and native consumer
suites supply revocation, selected retirement, history/phantom/unique conflicts,
native hooks and rollback/recovery obligations.

## Reference and scope

The inspected local Convex committer validates the transaction read set between
its begin timestamp and chosen commit timestamp before processing coalesced
writes (`crates/database/src/committer.rs`, `validate_commit`). This supports
keeping exact dependency validation at its trusted accepting owner. It does not
prove a PostgreSQL lock/snapshot plan or authorize dropping any check. The
candidate retains its explicit PostgreSQL scope-clock order and separate native
framework/Application profiles; no Convex implementation is copied.

All changes stay in this folder. Payload/Medusa bindings, native services,
workflows, schema, migrations and physical session settlement are unchanged.
No new schema/data migration, fallback or persistent compatibility path exists.

## Matched measurements

Eight final control/after campaigns passed with complete outputs/readbacks,
observers, source checks and fresh-resource cleanup. The unchanged harness uses
five warmups and 30 alternating native/candidate pairs per flow in separate
latency and CPU processes; SQL uses two pairs. PostgreSQL 18.3 serves through
ordinary roles with fsync, synchronous_commit and full_page_writes enabled.
Control and after are sequential cohorts, each with its own native reference.

The connected inventories contain 85,970 identical paths. Control digest is
`ad14fd1544d33b370ea5fffc7532a7167395c05ea6cbb9fb792ba15a5a5eefd5`;
after is `2349cc15f551c319850e3df875f0012af94a0f2711f73196acf18c7c9a0d4d50`.
Scaling has 85,883 paths, with control digest
`3a3c53e40fac3a3e89e34513b2fc96308b45dc92e4b2e3c508f27d22eec07596`
and after `41bf4198e8b2b783d105123d4976dbee2a23d2793597f9203fc386303c18a793`.
Both comparisons differ in exactly the seven modified runtime files listed in
the [comparison receipt](./validation/operation-comparison.json). The new
settlement observation module has identical bytes in both inventories and is
unimported in the control. Native packages, installed/compiled dependencies,
Node and harness bytes remain identical. Temporary control replay is restored
byte-for-byte; it is not a retained implementation or fallback.

Milliseconds, median / P95. Added percentiles use paired differences.

| Flow | Control native | Control candidate | After native | After candidate | Added control → after |
| --- | --- | --- | --- | --- | --- |
| Payload CRUD | 4.790 / 5.694 | 33.592 / 37.806 | 4.293 / 5.090 | 28.464 / 34.344 | **28.832 / 32.870 → 23.974 / 29.746** |
| Product | 10.322 / 13.544 | 16.281 / 21.177 | 9.679 / 12.861 | 15.177 / 18.792 | **6.025 / 10.647 → 5.627 / 8.210** |
| Mixed | 23.214 / 28.285 | 31.034 / 36.883 | 20.951 / 24.853 | 26.906 / 31.558 | **6.596 / 13.857 → 6.072 / 9.592** |

All three still miss the 5 ms added-median allowance. Product and mixed pass
the 10 ms P95 allowance; Payload misses it. Native medians also shift between
cohorts. This is bounded matched evidence, not an exclusive causal attribution
of every wall-clock change or a production performance acceptance.

Both SQL pairs agree, with zero unknown/lost/dropped observations:

| Flow | Exchanges before → after | Explicit transactions/checkouts |
| --- | --- | --- |
| Payload CRUD | **88 → 77** | 12 / 12, unchanged |
| Product | **37 → 33** | 5 / 5, unchanged |
| Mixed | **59 → 53** | 10 / 10, unchanged |

The probes still execute inside PostgreSQL; one scalar verdict is not one
underlying check. Native Payload remains 15 exchanges; native Product remains
10 Knex queries, a different metric. The mixed reference uses independent
framework commits and the same standalone candidate Application implementation.
That Application reference also improves from 27 to 24 exchanges. It is not an
equivalent atomic native mixed baseline or an active-core speedup comparison.

Representative first-pair returned rows fall 42→30 / 13→10 / 30→18 and decoded
JSON bytes 6639→5848 / 2818→2624 / 6061→5253. These include control projections;
they are neither document counts nor wire/memory sizes. Both pairs remain in
the receipt; clock/result encoding can vary their byte totals.

Paired added root-thread CPU median/P95 changes 16/32→15/31 ms for CRUD,
0/31→0/16 for Product and 0/32→-1/32 for mixed. Windows counters resolve about
15–16 ms. Negative/zero differences do not establish negative/zero cost or
exclusive CPU savings. CPU-campaign wall times are separate from the declared
latency cohort; retain its control CRUD maximum of 176.527 ms and all outliers.
Exact server planning/CPU, lock hold/wait, allocations and WAL remain unavailable.

## Batch and contention diagnostics

The same SDK corpus covers 1/16/64 rows, five warmups and five timed samples per
cell, followed by separate SQL observations. At 64 rows:

| Operation | Median/P95 before → after, ms | Exchanges before → after |
| --- | --- | --- |
| Insert | 113.107 / 144.565 → 90.231 / 103.278 | 279 → 276 |
| Overlay | 133.876 / 139.435 → 129.644 / 135.127 | 428 → 424 |
| Indexed edit | 103.488 / 115.458 → 109.513 / 146.102 | 282 → 279 |
| Nonindexed edit | 98.753 / 234.975 → 94.206 / 102.966 | 282 → 279 |

Indexed-edit latency worsens despite fewer exchanges. The 64-row insert still
performs 64 historical point observations and 67 short transactions; this slice
does not remove its per-row scaling problem. Unrelated-definition controls
(0 versus 64 definitions and 256 unrelated retained rows) use 27→24 exchanges
in both cells, without establishing constant physical database work.

Each contention cell executes 128 independent one-row SDK commands through the
same four-client pool. All 768 commands per campaign succeed on their first
attempt; automatic retries remain disabled and committed readbacks pass.

| Concurrency / scopes | Requests/s before → after | P95 ms before → after |
| --- | --- | --- |
| 1 / same | 136.462 → 160.624 | 8.702 → 6.964 |
| 1 / different | 137.618 → 151.441 | 8.452 → 7.605 |
| 4 / same | 212.303 → 239.455 | 22.343 → 19.169 |
| 4 / different | 279.942 → 317.595 | 15.657 → 13.808 |
| 8 / same | 245.305 → 276.449 | 37.453 → 32.384 |
| 8 / different | 270.386 → 320.191 | 33.639 → 34.526 |

Both concurrency-4 cells meet the unchanged diagnostic target of at least 100
requests/s, P95 below 100 ms and zero exhausted attempts. The different-scope
concurrency-8 P95 slightly worsens. These are bounded local diagnostics, not a
production capacity/SLO result or proof that scope-clock serialization is solved.

## Validation, rejected preparation and disposition

The complete explicit experimental suite passes 357 distinct cases: 156 named
PGlite cases, 175 ordinary-role PostgreSQL cases, 20 unit/boundary cases, three
additional PGlite SDK corpus cases and three native controller-process cases.
Its 23 expected skips comprise 19 PGlite exclusions for real-driver witnesses
and four opt-in measurement/comparison cases. Connected measurement and scaling
cases subsequently run in the eight separate campaigns. Scoped tsc-rs and the
explicit experimental lint pass; root lint does not cover this directory.
See the [validation receipt](./validation/operation-validation.json).

The initial development smoke was interrupted after an incomplete builder
failed; it earns no validation credit. A delayed daemon from that run was later
identified through its owner manifest and postmaster PID and stopped. Automatic
approval review rejected its directory cleanup with `blocked by policy`; the
stopped `flarex-core-pg-kU7RFs` directory remains recorded, with no alternate
deletion attempt. Fresh completed fixtures/campaigns clean up normally.

The first control latency preparation also failed before requests: initdb reached
the existing 60-second limit while syncing disk. The failed receipt remains at
[operation-control-latency.json](./validation/operation-control-latency.json),
with complete cleanup and no acceptance credit. An unchanged retry passes;
neither durability nor timeouts were weakened. This does not prove an exclusive
cause for the transient preparation failure.

Retain this bounded observation composition and modular/native ownership. Keep
performance promotion closed. Remaining per-row observations and short physical
transactions need a further explicit storage-operation contract; removing checks
or moving a transaction across a native callback is not an optimization path.
Representative Product relations, full native Payload lifecycle, general
Application/reactivity, all-five-graph and Worker/Hyperdrive gates remain open.

Raw campaigns use `operation-control-sql`, `operation-control-retry-{latency,cpu}`,
`operation-control-scaling`, `operation-after-{sql,latency,cpu}` and
`operation-after-scaling` in `validation/`. The comparison receipt links all
campaigns and exact source inventories; the earlier reports remain intact.
