# QSYNC-FX01-B Semantic Persistence Verdict

## Status

**Checkpoint status:** complete on 2026-08-29, docs only.

**Verdict:** stop before schema. Cloudflare SQLite is a feasible durable host for
the accepted query-sync state contract, and all nine operations have bounded
logical access plans. The current portable core does not expose those plans,
however. Its reusable reducers consume and rebuild the complete
`QuerySyncState`. A normalized SQLite implementation would therefore have to
load the maximum aggregate or reproduce material reducer, invariant, and
counter logic in host SQL. Both are rejected.

This checkpoint authorizes no DDL, local storage-contract generation,
migration, Durable Object behavior, state-adapter code, or C1-C3 semantic
vertical. `QSYNC-FX01-C1`, `QSYNC-FX01-C2`, and `QSYNC-FX01-C3` remain blocked.

The separate portable-core
[`QSYNC01-D0` preflight](./09-qsync01-d-operation-scoped-transition-plans.md)
was subsequently accepted docs-only. It freezes the operation-scoped
transition-plan seam and D1-D4 sequence but implements nothing. This B record
remains the access-plan evidence; D owns the portable correction. Every D code
slice still requires explicit approval.

## Decision Summary

| Question | Verdict |
| --- | --- |
| Can one named per-scope Durable Object own this coordination state? | Yes, subject to authenticated route/binding proof and externally authorized first initialization. |
| Can Cloudflare SQLite provide the required synchronous atomic boundary? | Yes in principle; every semantic operation fits one synchronous transaction with normalized rows. |
| Can every operation use a bounded logical read and write set? | Yes; the nine plans are frozen below. |
| Can the current portable reducer API consume those bounded facts? | No; every material mutation rebuilds the complete aggregate. |
| May the backend duplicate the reducers or capacity arithmetic in SQL? | No; that would create a second semantic authority. |
| May B accept candidate DDL, indexes, a storage generation, or migration? | No. Only logical row families and access/index purposes are retained as requirements. |
| Is Cloudflare the blocker? | No. The blocker is the missing portable operation-plan seam. |

`QSYNC-FX01-A` remains complete in `5f2a9e69`, private, and production-inert.
It supplies the Flarex model encodings and pure mapping boundary that later
adapters consume. B does not change those contracts.

## Fixed Authority And Ownership

The accepted authority order remains unchanged:

- Postgres owns application rows, scope generation and fence, current epoch,
  scope-lifetime commit sequence, retention floor, authoritative source facts,
  snapshots, and recovery history.
- `@flarex/query-sync` owns admission, query/dependency/generation semantics,
  evaluation and publication recovery, replay decisions, exact limits, and
  semantic receipts.
- `flarex-protocol` owns versioned Flarex encodings without importing the
  portable engine.
- `flarex-backend` later owns one concrete per-scope Cloudflare SQLite adapter
  and the Flarex mapping into the portable engine.
- a later authenticated host supplies trusted scope/head authority and invokes
  the adapter; a client request, wake hint, query descriptor, or object name
  never mints that authority.
- source reads, query execution, publication delivery, client sessions, and
  public APIs remain outside the state transaction and outside FX01-B.

The existing route spelling is `deployment-sync:${scopeUuid}`. It selects
placement only. Construction must strictly parse `ctx.id.name`, reject absent,
malformed, oversized, `idFromString`, and unique-ID cases, and require the
parsed scope to equal the authenticated `ScopeSyncActiveHeadObservationV1`
scope. Each object/turn adapter closes over exactly one scope, fixed model,
epoch, Flarex storage generation, and fence. Operations recheck that binding
inside the transaction before semantic reads or writes.

Creating an empty store additionally requires a nominal, one-use,
externally-durable fresh-initialization authorization. An empty database,
constructor re-entry, eviction, or hibernation is not evidence that the scope
has never held coordination state. No production mint is authorized here.

The adapter remains a plain per-object, multi-instance value. It is not a
module singleton or singleton Effect Context service. A Layer may construct
stateless host capabilities, but it may not collapse dynamic object binding or
storage lifetime.

## Why The Current Core Cannot Back A Bounded Adapter

The public shape is correct: `QuerySyncTransitionState` declares exactly nine
semantic receipt operations in `packages/query-sync/src/state/Port.ts`. The
storage seam beneath it is not operation-scoped:

1. `QuerySyncState` is the complete aggregate, including all queries,
   dependency directory, publication lifecycle state, revision/fairness state,
   and exact metrics (`packages/query-sync/src/kernel/Model.ts`).
2. The reference store supplies the complete aggregate to every operation and
   swaps one complete `nextState`
   (`packages/query-sync/src/testing/conformance/ReferenceStateStore.ts`).
3. Every mutating path in `Policy.ts`, `EvaluationWork.ts`, and
   `PublicationWork.ts` calls `rebuildQuerySyncState`.
4. `rebuildQuerySyncState` delegates to `buildQuerySyncState`, which traverses
   every query and publication, validates global lifecycle relationships,
   rebuilds the reverse-dependency directory, and recomputes every metric.
5. `claimEvaluationWork` additionally rotates the complete query array and
   revalidates the scanned prefix rather than consuming a bounded page
   projection.
6. Initialization policy is independently expressed by the reference store and
   the conformance harness; there is no shared production decision owner.
7. No `TransitionPlan`, `OperationPlan`, `ReadSet`, `WriteSet`, staged-read
   intent, or equivalent portable seam exists.

The portable maxima make an aggregate-load adapter materially unsafe: 4,096
queries, 262,144 dependency memberships, 32 MiB retained query identities,
32 MiB retained publication content, and 64 MiB counted canonical state. The
64 MiB is not a heap estimate; decoded objects, indexes, copied bytes, driver
rows, and the next rebuilt aggregate add overhead against the current 128 MiB
Workers isolate limit.

A partial synthetic aggregate is not a valid shortcut. It would undercount
capacity, omit collision and publication cross-link facts, change ordering,
and make untouched rows invisible to global invariants. Reimplementing the
missing decisions and accounting in SQL is equally invalid because the backend
would become a second reducer. The complete aggregate may remain a testing
oracle, never the production transaction input.

## Common Transaction Contract

Every operation below follows the same physical discipline:

1. begin one `transactionSync` callback;
2. read and validate the local storage-contract marker and closed-over
   scope/model/epoch/generation/fence binding;
3. read the scope singleton containing cursor, evaluation revision/fairness
   anchor, and exact counters;
4. stage only the operation-specific indexed rows after cheaper cursor or replay
   decisions establish that they are needed;
5. fully consume, decode, detach, and freeze all cursor data synchronously;
6. invoke one portable pure operation planner;
7. check exact compare predicates, capacity, row counts, and counter results;
8. apply every planned insert, update, and delete plus singleton counters; and
9. return the projected receipt only after the transaction commits.

The callback contains no `await`, network, source read, query execution,
publisher call, alarm, wake, Effect runtime invocation, or escaped cursor or
transaction handle. A decode, invariant, capacity, affected-row-count, or write
failure rolls back the entire operation.

Duplicate, gap, reset, replay, superseded, expired, and unchanged branches must
avoid unrelated reads and perform no writes unless the operation plan explicitly
defines a coalescing or durable fairness update. No adapter may infer writes
from receipt tags independently of the planner.

## Bounded Plans For The Nine Operations

The following are logical requirements, not accepted tables or DDL.

### 1. `initializeOrInspectNamespace`

**Reads:** local contract marker; durable previously-initialized evidence; the
scope singleton and counters if present. The bootstrap namespace, model, and
epoch must equal the closed binding. Its sequence is create-if-absent data, not
authority to overwrite an existing cursor.

**Decision:** fresh authorized absence, existing, model replaced, epoch
replaced, incompatible, or corrupt. This policy currently lacks one shared
portable reducer.

**Writes:** only a fresh authorized absence inserts the singleton, zero
cardinality/member/content counters, the exact nonzero empty-state base byte
counters, revision `0`, null fairness anchor, empty semantic publication state,
and durable initialized evidence. Every existing/model/epoch inspection branch
is read-only. Absence after prior initialization is corruption.

**Replay:** a committed initialization whose response was lost returns
`existing`, never a second `initialized` receipt.

### 2. `beginQueryEvaluation`

**Reads:** cursor; target query by canonical key with its full identity; active,
provisional, and completion links; revision/fairness state; and counters needed
for query, identity, provisional, and canonical-byte limits. It reads no
dependency or publication collection.

**Portable semantic owner:** `beginQueryEvaluation` in `kernel/Policy.ts`, with
`projectBeginReceipt` in `state/Receipts.ts`, which also owns the receipt
projectors named below.

**Writes:** a created provisional inserts or updates the target query, bumps the
work revision, and updates exact counters. Exact replay may coalesce a newer
active dirty frontier into the existing provisional and bump the revision.
`alreadyAdvanced`, `notDirty`, and replay without coalescing write nothing.

**Replay:** returns the same generation with current durable evidence, including
any coalesced newer dirty frontier, or `alreadyAdvanced` after later durable
progress.

### 3. `applyAdmittedBatchAndAdvance`

**Reads:** cursor first. Only an exact-next batch reads active dependency
memberships for the admitted keys, distinct affected active query rows,
revision/fairness state, and counters. The hard work bounds are 65,536 reverse
dependency lookups and 4,096 affected queries.

**Portable semantic owner:** `applyAdmittedInvalidations` in
`kernel/Policy.ts`, with `projectApplyReceipt`.

**Writes:** every exact-next batch advances the cursor, including an empty or
unmatched batch. It updates each affected active dirty frontier. It bumps the
work revision only when at least one query is affected and writes exact
counters in the same transaction. Dependency rows are unchanged. Duplicate,
gap, and reset decisions write nothing.

**Replay:** retrying the same committed batch returns `duplicate`; it never
reapplies dirty frontiers.

### 4. `completeQueryEvaluation`

**Reads:** cursor; full scalar state for the target query; old active and current
completion dependency rows; exact counters; retained pending or in-flight
publication evidence required for replay; and publication lifecycle rows tied
to the query needed to validate cross-links.

**Portable semantic owner:** `completeQueryEvaluation` in `kernel/Policy.ts`,
with `projectCompleteReceipt`.

**Writes:** on completion, replace active state, clear provisional, replace the
current completion fingerprint, move the prior current identity to preceding,
and bump revision. Replace active and completion-fingerprint dependency rows.
For first activation or a changed digest, delete any older pending publication
for this query and insert the new pending intent. Update all counters atomically.
Refresh, resnapshot, rerun, replay, superseded, and expired decisions write
nothing. Existing in-flight publication state is never removed here.

**Replay:** an exact retained fingerprint returns `replayed`. Conflicting
content fails while pending or in-flight publication bytes are retained. After
delivery, replay is fingerprint/digest based because latest-delivered evidence
does not retain the result bytes; different otherwise-valid content is not
compared there. Later generations return `superseded` or
`recoveryEvidenceExpired`.

### 5. `claimEvaluationWork`

**Reads:** cursor; revision and fairness anchor, including proof that the anchor
exists; then a slim canonical-query-key ordered eligibility page bounded by the
requested inspection window, continuation, wrap, and `hasMore`. After
selection, point-read the selected query's complete descriptor/identity and
attempt facts rather than loading identities for the whole scan. Read exact
counters whenever creating a provisional or changing the fairness anchor can
change counted state.

**Portable semantic owner:** `claimEvaluationWork` in
`kernel/EvaluationWork.ts`, with `projectClaimEvaluationWorkReceipt`. The
current full-array rotation and prefix revalidation is the specific missing
paged-read seam.

**Writes:** claiming a ready provisional records the selected fairness anchor
and exact resulting counters without changing revision. Claiming a dirty active
query creates its provisional, records the anchor, bumps revision, and updates
counters. Continued, restarted, blocked, and none decisions write nothing.

**Replay:** recovery asks for current durable work; fairness may reclaim the
same provisional or select another eligible current query. There is
intentionally no exact-claim replay receipt or lease.

### 6. `recordEvaluationAttemptOutcome`

**Reads:** cursor; target descriptor; provisional generation and disposition;
active generation; current completion attempt fields; preceding completion
identity; revision; and counters.

**Portable semantic owner:** `recordEvaluationAttemptOutcome` in
`kernel/EvaluationWork.ts`, with
`projectRecordEvaluationAttemptOutcomeReceipt`.

**Writes:** the first terminal refusal marks the provisional blocked, bumps the
revision, and updates exact counters. Transient exhaustion, an already-blocked
replay, superseded, and expired outcomes write nothing.

**Replay:** transient remains eligible; terminal refusal replays as blocked;
later durable completion yields superseded or expired evidence.

### 7. `claimPublication`

**Reads:** one state-owned clock instant; cursor and counters; existing
in-flight publication first. Only when no in-flight work exists does it read the
lowest pending publication in canonical `(queryKey, generation)` order and the
owning query integrity projection.

**Portable semantic owner:** `claimPublication` in
`kernel/PublicationWork.ts`, with `projectClaimPublicationReceipt`.

**Writes:** an age-expired in-flight attempt becomes blocked and updates exact
lifecycle/settlement counters. A fresh claim deletes/moves the selected pending
row into in-flight state with ordinal `1`, the captured first/last attempt
instant, and ready disposition, then updates counters. Existing replay,
already-blocked, and none decisions write nothing. Latest delivered and
preceding outcome remain unchanged.

**Replay:** existing in-flight state returns `replayed` with the same persisted
instant and ordinal.

### 8. `recordPublicationAttemptOutcome`

**Reads:** one state-owned clock instant; cursor and counters; exact in-flight
identity, digest, ordinal, first/last instants, and disposition; preceding
outcome/receipt; latest-delivered evidence; and referenced query integrity.

**Portable semantic owner:** `recordPublicationAttemptOutcome` in
`kernel/PublicationWork.ts`, with
`projectRecordPublicationAttemptOutcomeReceipt`.

**Writes:** a matching live attempt advances ordinal, last-attempt instant, and
ready/uncertain disposition or marks the attempt blocked. It replaces the one
preceding outcome fingerprint and durable replay receipt in the same
transaction. Exact retained replay, conflict, superseded, expired, and
already-blocked branches write nothing.

**Replay:** exact retained evidence returns the prior recorded/blocked receipt;
a conflicting result fails. Once displaced, older recovery evidence expires.

### 9. `completePublication`

**Reads:** cursor and counters; exact in-flight publication; latest-delivered
tombstone; and referenced query integrity.

**Portable semantic owner:** `completePublication` in
`kernel/PublicationWork.ts`, with `projectCompletePublicationReceipt`.

**Writes:** matching acceptance clears the in-flight row, upserts latest
delivered identity/digest, and updates counters. It preserves the preceding
outcome. Replay and superseded decisions write nothing. There is no pending
deletion here: claim already moved/deleted the pending publication.

**Replay:** latest-delivered evidence returns `replayed`; a displaced identity
returns `superseded`.

## Required Logical Access Paths

These are index purposes that any later schema must satisfy; they are not
accepted index names or SQL:

| Access path | Required purpose |
| --- | --- |
| singleton authority/revision/counters | binding, cursor, fairness, exact capacity, recovery, and atomic counter ownership |
| unique canonical query key with full identity beside it | exact lookup plus collision detection |
| dependency `(role, dependencyKey, queryKey)` | bounded reverse invalidation lookup |
| dependency `(queryKey, role, generation)` | bounded forward replacement and parent/generation validation |
| canonical query-key eligibility order | deterministic evaluation scan, wrap, fairness, and continuation |
| pending-by-query uniqueness | at most one newer pending publication for a query and deterministic replacement |
| pending `(queryKey, generation)` order | deterministic next-publication selection |
| exact publication identity plus one namespace-wide in-flight singleton | replay, outcome recording, completion, and single-flight enforcement |

Every later physical index must name at least one read, uniqueness, recovery, or
invariant path from this table. No speculative convenience index is accepted by
B.

## Exact Counters, Limits, And Corruption

The operation planner must own exact after-counters or exact deltas for:

- query count;
- retained identity bytes;
- dependency memberships;
- pending publication count;
- in-flight publication count;
- retained publication bytes;
- settlement-envelope bytes; and
- total counted canonical bytes.

Those counters live with the scope singleton and change in the same transaction
as their rows. The host verifies safe physical representation and exact affected
row counts, but it does not independently derive semantic deltas.

Portable maxima remain unchanged: 4,096 queries, 262,144 memberships, 32 MiB
identities, 64 MiB total counted canonical state, 65,536 invalidation keys,
4,096 affected queries, 4,096 evaluation inspections, 4,096 pending
publications, one in-flight publication, one newer pending publication per
in-flight query, 32 MiB retained publication content, 1 MiB inline content,
ordinal 128, and the inclusive seven-day attempt threshold.

A lower demonstrable host capacity must fail before mutation with
`QuerySyncStateCapacityError`; it may not truncate, silently lower a portable
limit, or partially commit. Later schema proof must measure encoded row and SQL
statement size, base64url expansion, limit-plus-one reads, and bounded repeated
statements under Cloudflare's row/value and parameter ceilings.

Every row in an operation's declared read set is decoded and validated.
Constraints plus transaction-owned counters protect untouched state. Requiring
each operation to discover arbitrary corruption in unrelated rows would
reintroduce the prohibited aggregate scan; a separately gated bounded audit may
be added later if operational evidence requires it.

Malformed or noncanonical values, duplicate/missing singleton or child rows,
orphans, wrong role/parent/generation, excess rows, identity-key disagreement,
and inconsistent counters are stored-state corruption. An unsupported local
storage-contract generation is incompatible, not corrupt. Foreign driver
property access, cursor iteration, or platform failures remain foreign defects
unless the boundary has positively established malformed stored data.

## Clock Authority

The C4 publication contract gives the real durable state adapter ownership of
publication attempt time through its transaction/database clock. The earlier
FX01 preflight wording that captured Effect time before `transactionSync` is
superseded.

For `claimPublication` and `recordPublicationAttemptOutcome`, a later
Cloudflare adapter must read one validated millisecond instant synchronously
from SQLite inside the same `transactionSync`, before invoking the pure planner,
and pass that one `PublicationAttemptInstant` through the decision. It must not
call `Date.now`, an Effect runtime, or async work in the callback. A test adapter
may inject a deterministic synchronous clock reader. The exact production SQL
spelling remains a later implementation decision.

If Cloudflare SQLite cannot later satisfy that authority contract, work stops
for an explicit superseding preflight. Host wall time or pre-transaction Effect
time must not silently become authoritative.

## Local Storage Contract And Migration Boundary

Three generations remain separate:

1. the Wrangler Durable Object namespace migration;
2. the local SQLite adapter storage-contract generation; and
3. the authoritative Flarex scope storage generation/fence.

The existing local store has a cursor-only contract marker. A later accepted
migration must recognize its exact supported generation and upgrade that same
database atomically in place while preserving scope, epoch, storage generation,
fence, and cursor. Unsupported generation is incompatible; malformed supported
state is corrupt. There is no drop/reset, parallel table set, data copy into a
second authority, dual write, fallback, or silent repair.

B does not choose DDL, mint the next local generation, or authorize the
migration. The logical families retained for later proof are only: one scope
singleton, query scalar rows, query dependency rows, publication rows, and
single-flight/publication recovery state.

## Effect And Failure Boundary

The existing query-sync integration error vocabulary remains closed:

- a positively recognized busy/locked/transient failure known to have rolled
  back may map to operation unavailability/contention with `notCommitted`;
- a truly indeterminate commit remains
  `QuerySyncStateCommitOutcomeUnknownError` with `unknown` certainty;
- documented local quota or accepted lower host capacity maps to
  `QuerySyncStateCapacityError`;
- admitted stored-data corruption and unsupported local generation map to their
  existing typed stored-state errors; and
- SQL programming mistakes, schema/constraint defects, kernel invariants,
  unexpected driver failures, interruption, cancellation, and Effect defects
  retain their Cause and do not become ordinary retryable failures.

Cloudflare's synchronous transaction may not naturally produce an unknown
result after throwing. The adapter must not fabricate uncertainty to exercise a
type. Response-loss fault wrappers can prove replay at the semantic boundary.

## Required Conformance Before C1-C3

`QSYNC01-D` must first prove that operation-scoped planners produce the same
receipts and complete oracle state as the existing aggregate reducers for all
current histories, including collision, replay, ordering, limit, uncertainty,
and atomicity vectors.

After that gate, a future real SQLite adapter must add proof for:

- every staged physical write failure rolling back the complete transaction;
- fresh authorized creation and exact cursor-only upgrade;
- constructor re-entry, dispose/reopen, and genuine eviction/reconstruction;
- response-loss replay for every replayable operation;
- normalized malformed, noncanonical, orphan, duplicate, missing, excess,
  wrong-parent, and wrong-generation rows;
- exact counters and every boundary-plus-one capacity refusal;
- multi-table replacement rollback and exact affected-row checks;
- namespace isolation and route/authenticated-binding mismatch;
- signed integer and canonical decimal-text round trips without precision loss;
- no cursor or transaction escaping across `await`; and
- removal or fencing of the old direct cursor path so it cannot bypass semantic
  invalidation.

The current Workerd suite proves only cursor-store isolation, exact decimal
round trips, replay, compare-and-swap, selected corruption, rollback, and
callback-defect preservation. It is not nine-operation conformance. Persisted
Miniflare dispose/recreate can prove reopen; targeted eviction needs an explicit
harness/dependency decision before C3.

## Platform Evidence

Platform facts were rechecked on 2026-08-29 against Cloudflare's official
[SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Durable Object ID contract](https://developers.cloudflare.com/durable-objects/api/id/),
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/),
and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
Those sources currently support synchronous `transactionSync` rollback,
synchronous cursor consumption, per-object durable SQLite, a 2 MiB maximum
string/BLOB/row, 100 bound parameters, a 100 KiB SQL statement, 10 GiB per paid
object, absent names for non-name ID paths, constructor re-entry after in-memory
state loss, and a 128 MiB isolate memory limit. SQL numeric reads above the
JavaScript exact-integer range also require deliberate representation.

These facts show that Cloudflare is viable, not that a schema is accepted.
Platform limits are host evidence and may not silently redefine portable engine
limits.

## Accepted Subsequent `QSYNC01-D` Core Boundary

The accepted D0 record retains B's smallest clean correction: a private
portable family of operation-scoped fact reducers:

- inputs contain a decoded scope summary and only operation-specific facts;
- outputs contain a frozen semantic decision/receipt projection, exact compare
  predicates, explicit inserts/updates/deletes or equivalent logical mutations,
  and exact after-counters/deltas;
- invalidation and evaluation selection may emit staged bounded read intents;
- clocked planners accept one state-owned `PublicationAttemptInstant`;
- nominal evaluation/publication attempts and continuations remain core-minted
  and are not serialized;
- SQL, Cloudflare, driver types, transactions, Effect runtime ownership, host
  errors, Flarex types, arbitrary callbacks, generic CRUD, and aggregate-save
  APIs remain outside the core; and
- current aggregate reducers and the reference store are refactored to consume
  the same planners, while complete aggregate rebuild remains a test oracle.

Acceptance of the implemented seam requires reducer-equivalence, replay,
limit, ordering, fault, and atomicity proof before any SQLite implementation.
D0 resolves pagination as a small closed staged-read family with slim bounded
facts and nominal process-local resume capabilities, without a host-shaped
cursor. See the linked D record for the authoritative contract and gates.

## Explicitly Not Authorized

This completed docs checkpoint does not authorize:

- `QSYNC01-D1` through `QSYNC01-D4` implementation;
- SQLite DDL, index names, a new local storage-contract generation, migration,
  or changes to `DeploymentSyncDO` or `deploymentSync/Store.ts`;
- a Postgres source adapter, catch-up loop, query evaluator, publisher, wake,
  alarm, RPC/fetch route, client gateway, stream, or production caller;
- a second semantic reducer, aggregate blob, lower unrecorded limit, dual table
  set, dual write, fallback, shadow comparison, or silent reset;
- OCC, commit, journal, idempotency, authoritative-row, retention, or outbox
  changes;
- release/removal/reset transitions not present in the nine-operation state
  port; or
- public/runtime portability, `R03-B`, `SV-R Live`, or production readiness
  claims.

## Next Checkpoint

Discuss and explicitly approve or reject a fresh `QSYNC-FX01-C1` checkpoint.
D1-D4 now complete all nine planners, but FX01 still has no implementation
slice until that adapter checkpoint is approved: `QSYNC-FX01-C1` remains
blocked and no schema work should begin.
