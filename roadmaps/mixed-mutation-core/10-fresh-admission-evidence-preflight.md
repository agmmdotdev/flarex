# Fresh admission evidence within one checked transaction

Status: **bounded private implementation delivered; proposed latency goals
unmet.** This is the next private cost slice after the delivered
[checked operation composition](./09-checked-operation-composition-preflight.md).
It changes how already-required live evidence is shared **inside each short
checked transaction**. It does not grant authority from an earlier operation,
another transaction, a prepared object, or a callback. The
[accepted prepared-execution rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
and the protected metadata guard remain authoritative.

## Connected outcome and measured reason

Keep the same Product update, Product plus selected Payload Local API, finite
Product/Pricing/Link/Tag workflow, and separately settling standalone workflow
graphs. In every checked operation, read and authenticate the active
Application head, activation and revision evidence once where the existing
binding and coverage owners can prove equivalence, then reuse that **fresh
transaction-local** evidence for selected index, unique and search readiness.
Retain the separate checked transaction for every observable operation. Its
attempt, scope, placement, clock, source, revocation, claim, fence, journal
position, physical facts and tail guard remain live checks.

The [09 retained evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/checked-operation-composition/README.md)
has full warm outer p50 of **1,849.5 / 2,264.6 / 4,847.1 / 318.4 ms** and a
quiet traced **2,646 / 3,564 / 6,976 / 470** SQL dispatches with **82 / 105 /
199 / 6** checked transaction intervals per warm request. Product warm p50
rose from 1,758.7 ms even as its SQL count fell; no causal speedup is
established. The proposed mixed warm p50 goals of 100 / 200 / 500 ms remain
unmet. The Product update phase still has 49 checked transaction intervals,
and the workflow run phase has 94. Those operation boundaries are retained:
relational handles are observable, charged operations, and raw input capture
must remain after authority refusal and outside SQL.

The 09 quiet trace records three active-head reads, three activation reads,
two revision-schema reads and three selected-frontier reads per checked
interval in both Product update and workflow run. The frontier count includes
two batched frontier CTE passes plus a separate selected frontier probe. The
mapping is an inference from SQL
templates plus the current call graph, not a traced function stack or proof
that every repeated statement has identical semantics. A possible structural
ceiling is two coherent-head passes per interval, with frontier reuse only
when its scope, table selection and clock match. The implementation must
demonstrate which reads are actually equivalent; this arithmetic is not a
latency promise or permission to suppress a check.

## Owners and trust boundary

The [journal store](../../packages/persistence-postgres/src/execution/sessionJournalStore.ts)
starts a checked operation through the
[attempt kernel](../../packages/persistence-postgres/src/execution/session/attemptKernel.ts),
which authenticates the exact running attempt, current scope clock, session,
claim and journal position and flushes protected metadata guards at the
successful transaction tail. The [participant admission
owner](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
verifies each source in that transaction. The [source binding
owner](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts)
already shares selected binding head/candidate evidence for multiple sources
inside one transaction and discards it at the boundary; it never licenses a
later call.

The [Application binding projection](../../packages/persistence-postgres/src/application/applicationBindingProjection.ts)
calls [active selection validation](../../packages/persistence-postgres/src/application/activation/bindingAcceptance.ts)
to read a coherent head and activation under `FOR SHARE`. The
[active-head reader](../../packages/persistence-postgres/src/application/applicationActiveHeadRead.ts)
owns decoding, revision-schema correlation and lock semantics. The
[readiness owner](../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts)
checks selected index coverage, closed unique sets and search readiness.
[Index coverage](../../packages/persistence-postgres/src/storage/indexes/indexBuildStates.ts)
owned a second coherent head/schema read and its transaction-bound
`IndexCoverageContext` at approval. [Unique coverage](../../packages/persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1.ts)
could read another such context and selected table frontiers. The
[Application physical readiness owner](../../packages/persistence-postgres/src/application/readiness/physicalCoverage.ts)
also checks selected physical build coverage while restoring an active
binding. The [search owner](../../packages/persistence-postgres/src/storage/search/logicalSearchBuild.ts)
retains a physical `pg_index` probe. These are real owners with distinct
error mapping; one new universal admission cache is not proposed.

## Internal cutover

1. Let the Application binding and active-head owners expose or pass the
   decoded coherent head, activation and revision-schema evidence that their
   first `FOR SHARE` read has actually authenticated. Preserve the current
   order of schema loading and failure projection: if the first read does not
   validate a needed schema member, retain that member's later check. Reuse
   proven evidence in an index
   coverage context only after proving the same transaction, scope, storage
   generation/fence, epoch, activation/head identity and snapshot clock. If
   that proof cannot be made on a branch, keep its current read. No untrusted
   caller can construct or retain this context as an admission token.
2. Thread that context through the readiness owner into index and unique
   coverage without repeating equivalent active-head/schema reads. Keep
   per-source pinned head and source-contract comparisons, required build
   rows, frontier validation, unique eligibility, search readiness and the
   physical index probe in their existing owners. Share selected table
   frontiers only for an exact transaction, scope, table set and clock whose
   semantics match both consumers. Missing rows and corruption are still
   decoded and refused by their original owner.
3. Preserve the readiness refresh loop under PostgreSQL `READ COMMITTED`.
   A commit may advance the scope clock between the first selection and a
   later coverage read. If a post-miss clock read advances, rebuild or refresh
   the coverage context and its frontier batch for that clock before retrying;
   never reuse a stale context or waive a persistent miss. A generation,
   fence, epoch, head, activation or schema mismatch remains a refusal.
4. Keep the protected metadata tail guard and its existing error and rollback
   behavior. The shared evidence ends with this one transaction. The next
   operation rereads live metadata even when it targets the same source,
   table, row, or cached result.

The implemented binding callback issues a positive checked active-head
observation and revokes it on success, typed failure and interruption. A
missing active head is never cached. Its retained evidence is detached from
mutable returned projections; revision schema is loaded lazily only after
the original ordered validation reaches that check. Index and unique
coverage borrow a matching context and selected frontier batch only for the
same transaction and exact scope, generation/fence, epoch, clock and table
selection. A later or advanced clock refreshes the evidence under its live
`READ COMMITTED` transaction. Application readiness, logical storage
readiness and the source binding owner pass that evidence through their
existing checks. The next operation always performs its own live admission;
no checked observation survives the callback as a capability.

## Measured outcome and remaining owner

The [retained quiet trace and full distribution](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fresh-admission-evidence/README.md)
use the same four business graphs and local host as the 09 comparison. SQL
dispatches fall from **2,646 / 3,564 / 6,976 / 470** to **2,256 / 3,018 /
5,872 / 452** per warm request; checked transaction intervals remain **82 /
105 / 199 / 6**. Product update still has 49 intervals and workflow run 94.
Within those phases, the traced active-head and activation templates each
fall from three reads to one per interval; revision-schema from two to one,
and selected frontier reads from three to two. This is a SQL-fingerprint and
phase comparison, not a function-stack attribution or a license to omit
other live checks.

Full untraced warm outer p50 is **1,551.6 / 2,013.6 / 4,471.4 / 308.8
ms**, compared with **1,849.5 / 2,264.6 / 4,847.1 / 318.4 ms** before the
slice. The three mixed warm p50 and p95 proposals remain unmet. Standalone
stays below its 400 ms ceiling and strict regression gate. The changed
source revision and Worker construction distribution prevent an isolated
causal latency claim. Repeated fresh admission remains the next measured
cost owner; its operation boundaries and live authority requirements are
retained. No next implementation scope or endpoint target is approved by
this measured result alone. The focused clock-advance boundary covers a
controlled `READ COMMITTED` refresh; it does not establish every concurrent
publisher interleaving or broader production workload. Server execution,
lock wait, WAL and capacity remain unmeasured.

This internal admission/readiness contract change migrated the affected
binding, Application readiness, logical readiness, index, unique and source
callers together and removed their displaced duplicate reads. Independent
standalone and `durableOperations` callers retain their ordinary fresh-reader
path and live checks where the exact evidence contract does not apply. No
compatibility wrapper or cross-transaction cache was needed for unshipped
internal contracts. No named durable data, schema,
migration, journal/receipt/commit format, public API, framework operation,
protected-table expansion, or host-lifetime decision changes here.

## Refusal, lifecycle and validation gates

Preserve first-failure order for invalid authority versus malformed input,
source mismatch, missing/invalid head, index and unique not-ready states,
stored corruption, and physical mismatch. The first binding read and its
`FOR SHARE` locks cannot be moved after a readiness result that used to run
later. Current scope authorization, generation, revocation, journal position,
source head and candidate, build coverage, unique closure, search/physical
facts and final epoch guard must still be checked within the accepting SQL
transaction. Do not hold that transaction across Product/Payload methods,
hooks, workflow callbacks, sandbox code, remote effects or foreign getters.
Do not widen limits or transfer this correction to framework adapters.

Focused PGlite and ordinary-role PostgreSQL tests should compare the old and
new order and exact evidence for Product, Payload and finite workflow, plus
the standalone regression. Include concurrent head replacement, generation
or revocation changes between operations; `READ COMMITTED` publication
advancement during coverage, followed by both recoverable refresh and a
persistent miss; changed index/unique/search/physical state; source order;
stored corruption; protected-epoch change or contention at the tail; and
scope/clock/table-set misuse of a coverage context. Assert that a later call
refuses after revocation even if its earlier checked operation succeeded, and
that malformed or Proxy-backed input does not run before authority refusal
or inside SQL. Keep cancellation and callback no-open-transaction witnesses,
OCC retry, unknown final outcome recovery and publication behavior. Validate
affected persistence, executor, backend, Medusa and Payload type boundaries,
focused connected tests, lint and both required reviewers before the
implementation is treated as delivered.

Use a quiet matched trace on the same graph, source-hash inventory, local
PostgreSQL host, restricted role and fresh Worker lifecycle. Require a
measured reduction in the named head/activation and eligible frontier
templates **per checked transaction**, with no compensating new read or
missing live check; record which branch still requires a separate read.
Preserve trace coverage, all samples and explicit exclusions. If claiming a
warm endpoint gain or deciding the existing latency targets, run the matched
full 104-sample untraced distribution and compare warm p50/descriptive p95,
cold p50, Worker construction, retained rows/events/journal bytes and setup
costs with the 09 series. The standalone warm p50 must stay within its strict
less-than-10% regression gate and below 400 ms. A two-warm traced smoke can
prove the structural question, not an endpoint percentile. Server execution,
lock wait, WAL and production/hosted behavior remain separate evidence gaps.
