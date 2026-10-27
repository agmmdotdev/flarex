# Batched new-ID validation

Status: implemented, validated and measured. Retain the bounded insert operation;
performance promotion remains closed. Active framework integrations are unchanged.

## Contract and hypothesis

The current 64-row insert performs 64 historical point observations and 67 short
transactions. A root-generated identity is a tentative insert intent, rather
than an existing-row acquisition. Keep those intents under the root and validate
their original absence together in its existing freeze transaction. The intended
result is a constant number of physical transactions for an insert-only command;
the bounded identity probes and publication work still grow with the batch.

The inspected Convex `crates/database/src/transaction.rs::insert_document`
enforces schema and stages `apply_validated_write(document_id, None, ...)`.
Its committer validates read dependencies before accepting writes. This is
evidence for separating pending insert construction from physical reads, not
permission to assume UUID collisions are impossible or omit Flarex's live gates.
No Convex code or new licensing dependency is copied.
The enclosing Convex source is pinned at
`84fbb0e70b4e857913673871cb847ad11a55f3d5`; the inspected committer is
`crates/database/src/committer.rs::validate_commit`.

## Ownership and boundaries

- The Application root privately allocates IDs and retains every new-ID intent.
  Callers cannot assert an arbitrary identity was generated. Duplicate IDs within
  the root fail closed instead of replacing another pending/original document.
- Schema decoding, creation-time allocation, unique ownership, row/dependency and
  byte budgets retain their existing local owners. New identities consume the
  same logical row/dependency budgets as their previous absent point reads.
- Freeze uses the existing private snapshot issuer and one short Drizzle
  transaction: acquire the existing fresh snapshot gate, then query retained
  identity history in a separate statement. The latter receives a fresh Read
  Committed snapshot after any gate lock wait. Any history, including tombstones
  or an older revision, refuses the candidate.
- A successful freeze exports exact absent-point dependencies for the validated
  IDs. Keep intents/dependencies for insert-then-delete, even when no final write
  remains. No unvalidated intent is an exported observation or write authority.
- Final acceptance retains its fresh authority/definition/fence/deadline and
  retention checks, scope-clock serialization and point/range invalidations.
  A collision committed after freeze must refuse the command. Mixed acceptance
  additionally retains its current predecessor and never-used-identity checks.
- Native/application callbacks remain outside SQL transactions. Committed data,
  history, indexes, outcomes and events still publish atomically through the
  existing accepting owner. Replay, cancellation, draining and uncertain-COMMIT
  recovery retain their current owners.

## Failure timing

Generated inserts are tentative local work after authenticated entry. A persisted
revocation or expiry during insert-only work is discovered at the next actual
storage boundary, including freeze, before publication. No cached permission
verdict authorizes a database read or commit. Existing reads and cached-point
checks keep their current fresh gates; this slice does not batch across a native
authorization callback or protected-body disclosure.

Identity-history collision detection moves from per-insert reads to freeze.
This is an internal generated-ID integrity failure, not a deferred native unique,
validation or access callback. A handler may receive tentative generated IDs and
perform further local work, but a refused root cannot return committed success.
Local schema failures remain catchable as before; sticky root failures remain
sticky. Required native business error timing is unchanged.

The preserved pre-change witness shows that both live and tombstoned generated-ID
collisions previously passed freeze: a point acquisition was not an explicit
never-used-identity refusal. This slice corrects that gap at the root/storage
owner. Duplicate local generation also refuses instead of replacing pending
state. Local validation, pending uniqueness or budget failures can precede
discovery of a post-entry revocation; they consult only owned local state and
cannot disclose database data or authorize durable success.

The existing dropped-insert-promise witness injected its paused defect through
`storage.point`. Once inserts stopped calling that method, its barrier could
never start. The test-only fixture now injects the same paused defect through the
actual insert decoder; the range case keeps its storage fault. Drain, complete
defect preservation, unhandled-rejection detection and no-publication assertions
remain in place. The original timeout report is retained without passing credit.

## Required witnesses and measurement

Cover old live and tombstoned identities, duplicate local generation, a concurrent
post-freeze insert, insert-then-delete, pending edits/read-your-writes, budgets,
caught sticky refusal, revocation/definition/fence/retention changes, expired
roots, late writes and cancellation. Real PostgreSQL must additionally prove a
post-lock-wait history observation and ordinary-role execution; PGlite results
are reported separately. Preserve current owner/consumer regressions.

Use the unchanged complete-request harness for Payload, Product and mixed SQL,
latency and CPU campaigns, plus the existing 1/16/64-row scaling corpus. Record
matched source inventories, all samples/refusals and cleanup. Payload/Product
do not inherently use Application inserts, so their counts may be unchanged.
The mixed reference also uses standalone candidate Application and can improve
with it; it is not an equivalent native atomic baseline.

## Complete-request results

Eight control/after campaigns completed with stable source, full output/readback
assertions and cleanup. The unchanged harness uses five warmups and thirty
alternating pairs per flow for separate latency and CPU processes, and two SQL
pairs. Ordinary serving roles use PostgreSQL 18.3 with `fsync`,
`synchronous_commit` and `full_page_writes` enabled.

| Flow | Exchanges before → after | Transactions/checkouts before → after |
| --- | --- | --- |
| Payload CRUD | 77 → 77 | 12 → 12 |
| Product | 33 → 33 | 5 → 5 |
| Mixed | 53 → 50 | 10 → 9 |

Both SQL pairs agree, with zero unknown, lost or dropped observations. Only the
mixed flow here uses Application inserts. Its separate standalone Application
reference also changes from 24 to 21 exchanges and four to three transactions.
These are candidate iteration results, without an active-core speedup claim.

Quiet median/P95 latency, milliseconds:

| Flow | Native reference before → after | Candidate before → after | Paired added before → after |
| --- | --- | --- | --- |
| Payload CRUD | 4.523/8.677 → 4.873/5.787 | 30.466/34.636 → 32.182/38.939 | 25.693/30.281 → 27.507/34.060 |
| Product | 10.380/13.599 → 10.375/12.975 | 16.488/19.535 → 16.442/23.021 | 5.845/9.765 → 6.013/13.246 |
| Mixed | 22.418/26.386 → 22.164/27.409 | 28.646/34.486 → 29.017/33.706 | 6.616/12.191 → 6.567/11.615 |

There is no overall complete-request latency win. Payload and Product P95 worsen;
mixed added latency is roughly unchanged. All three current added-median/P95
values miss the provisional 5/10 ms allowances. Retain every sample, including
the after mixed reference maximum of 63.636 ms and paired minimum -26.798 ms;
negative paired excess does not establish negative overhead or equivalent native
atomic execution. CPU is likewise inconclusive: paired thread median/P95 is
16/32 → 16/32 ms for Payload, 0/16 → 0/16 for Product and 0/17 → -1/17 for mixed.
Windows counters resolve about 15–16 ms. Server CPU/planning, exact lock hold/wait,
WAL and exclusive allocations remain unavailable.

## Scaling and contention

The existing SDK corpus uses five warmups and five timed commands per cell,
followed by a separate SQL observation. At 64 rows:

| Operation | Median/P95 before → after, ms | Exchanges before → after | Transactions/checkouts before → after |
| --- | --- | --- | --- |
| Insert | 96.796/105.661 → 29.434/32.865 | 276 → 21 | 67 → 3 |
| Overlay | 144.150/155.492 → 79.746/87.476 | 424 → 169 | 116 → 52 |
| Indexed edit | 108.388/109.358 → 112.724/139.336 | 279 → 279 | 67 → 67 |
| Nonindexed edit | 156.977/559.833 → 109.615/243.693 | 279 → 279 | 67 → 67 |

Insert cells at 1, 16 and 64 rows all use 21 exchanges and three transactions:
reservation, validated freeze and acceptance. The 64-row insert removes 64 point
acquisitions, reduces exchanges by 92.4% and transactions by 95.5%, with measured
median latency 69.6% lower. Database probes, local validation and publication
still grow with row count. Existing-row edits retain their per-row acquisition
cost; indexed-edit latency regresses. Keep the control nonindexed maximum of
559.833 ms and all other outliers. Unrelated-definition controls (0 versus 64
definitions plus 256 retained unrelated rows) use 24 → 21 exchanges and four →
three transactions in both cells; this does not establish constant physical work.

Each contention cell contains 128 independent commands, a four-client pool,
no automatic retries and complete committed readbacks. All 768 commands per
campaign succeed on the first attempt, with zero exhausted attempts.

| Concurrency / scopes | Throughput before → after, requests/s | P95 before → after, ms |
| --- | --- | --- |
| 1 / same | 108.993 → 126.223 | 10.323 → 8.051 |
| 1 / different | 109.070 → 150.702 | 12.305 → 7.890 |
| 4 / same | 193.668 → 173.261 | 24.972 → 94.398 |
| 4 / different | 243.918 → 329.784 | 22.494 → 14.801 |
| 8 / same | 204.191 → 201.064 | 53.877 → 180.313 |
| 8 / different | 278.020 → 336.914 | 38.421 → 27.233 |

Both concurrency-four cells pass the diagnostic 100 requests/s, P95 below 100 ms
and zero-exhaustion target, but same-scope throughput and tails regress. No
exclusive cause or production capacity is established by these bounded cohorts.

## Validation and evidence

There are 396 distinct passing correctness cases: 174 named PGlite, 196 named
ordinary-role PostgreSQL and 26 unit/SDK/controller cases. The 26 default skips
are 22 PostgreSQL-only witnesses excluded from PGlite and four opt-in comparison
or measurement cases. Connected and scaling measurements execute separately.
The new owner file contributes 18 PGlite and 21 PostgreSQL cases, including the
post-lock history snapshot, cancellation drain and real post-wait expiry with a
proved live margin after observing the lock wait.

The initial complete run contains 394 passes and the two obsolete fault-barrier
timeouts. Both complete affected test files subsequently pass on final bytes;
the [combined correctness receipt](./validation/insert-correctness-combined.json)
replaces their original results without double counting. The pre-change two
collision failures and an early simultaneous compiler/test allocation failure
remain retained without passing credit. Serialized `tsc-rs` with two Rayon
threads, experimental lint, root `lint:core` and `lint:diff` pass. No timeout,
durability setting, workload or behavioral assertion was weakened.

The [comparison receipt](./validation/insert-comparison.json) recomputes recorded
latency/CPU quantiles and checks SQL health and source inventories. Connected
inventories contain 85,970 → 85,971 files; scaling contains 85,883 → 85,884.
Exactly two runtime files change. The other differences are the corrected
Application test and added new-ID test; native implementations, workload,
harness, installed dependencies and Node bytes match. All owned campaign
resources close. No schema, migration, session, framework bridge or active
Medusa implementation changes are needed.

Decision: retain bounded root-owned new-ID validation. It removes the insert
batch's per-row transactions while keeping the explicit integrity and freshness
boundaries. Keep promotion closed: complete-request overhead, existing-row
acquisitions and same-scope contention tails still require further work.
