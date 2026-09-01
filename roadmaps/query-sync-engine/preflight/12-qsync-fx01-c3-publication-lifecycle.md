# QSYNC-FX01-C3 Private SQLite Publication Lifecycle

## Status

**Checkpoint status:** accepted on 2026-08-31. The medium generation-4
publication-lifecycle vertical, exhaustive phase-2 closure, and repeated
cross-operation and conformance phase-3 closure are implemented in the current
checkpoint. Exact limits and the final Workerd exit remain incomplete.
`QSYNC-FX01-C2` is complete and exited in `13ee4aa6`. C3 remains
package-private, unrouted, production-inert, and incomplete.

Acceptance authorizes only the DDL, migration, database clock, adapter work,
private naming cleanup, and proof inside this record. It does not itself
implement C3 and authorizes no public export, route, production caller,
publisher, or production activation. C3 is complete only after every proof gate
in this record passes.

## Accepted Decision

Complete the existing Flarex Cloudflare SQLite state adapter in place. Do not
create another sync engine, workspace package, Durable Object, registry,
cursor, reducer, aggregate state blob, or delivery subsystem.

```text
@flarex/query-sync/internal/transition-plan
  pure runtime-neutral publication decisions
                         |
                         v
flarex-backend/deploymentSync
  generation-4 normalized SQLite representation
  one synchronous transaction per state operation
                         |
                         v
private exact QuerySyncTransitionState
  nine methods, no route or production caller
```

The portable package remains the sole owner of query-sync semantics,
publication attempts, receipts, limits, accounting, recovery precedence, and
nominal capability rules. The backend adapter owns only Flarex binding,
physical representation, exact row decoding, bounded reads, database-clock
capture, compare-and-swap writes, transaction rollback, and integration-error
projection.

This is still the independent Query Sync Engine framework plus its first
Cloudflare SQLite adapter. C3 does not make Cloudflare part of the portable
core and does not make the adapter public or active.

## Commit-Grounded Basis

This checkpoint follows the existing implementation lineage rather than opening
a new design track:

- `bd7dc357` created the independent private `@flarex/query-sync` kernel;
- `51b52695` established the exact atomic state port;
- `1df70907` added durable evaluation and publication-attempt state;
- `87a7566f` completed bounded publication orchestration without adding a real
  publisher;
- `81505e47` completed the three pure publication transition planners and the
  all-nine portable proof;
- `b94abbb0` created the first private Cloudflare SQLite adapter vertical;
- `95f264a7` established the current generation-3 evaluation/module split; and
- `13ee4aa6` closed C2's pinned local Workerd exit matrix.

C3 consumes those completed owners. It does not reopen their semantics or use
their chronology as authority for a second implementation.

## Why Generation 4 Is Required

Generation 3 contains contract, scope, query, dependency, and pending-
publication tables. Its scope row already carries all eight portable metrics,
but valid generation-3 state requires zero in-flight publications and zero
settlement-envelope bytes. It has no representation for:

- the immutable in-flight publication and retained content;
- attempt ordinal, first and last attempt instants, or disposition;
- the latest-delivered identity/digest tombstone; or
- the preceding outcome fingerprint and durable replay receipt.

Generation 3 therefore cannot be reinterpreted as complete state. C3 must mint
local storage-contract generation 4. The authoritative Flarex storage
generation/fence and the Wrangler Durable Object namespace migration remain
separate contracts and do not change.

## First Medium C3 Slice

The first implementation slice is a medium, end-to-end private publication
vertical. It is a substantial but bounded checkpoint containing both
implementation and meaningful adapter evidence. It is not schema-only work and
not claim-only work.

The implementation part contains:

1. generation-4 catalog, migration, readiness, and lifecycle codecs;
2. one exact synchronous SQLite millisecond clock reader;
3. `claimPublication`;
4. `recordPublicationAttemptOutcome`;
5. `completePublication`;
6. generation-4 material-completion reads of real lifecycle facts; and
7. the exact private nine-operation `QuerySyncTransitionState` facade.

The same medium slice also proves:

1. exact fresh and generation-1/2/3 construction or migration for both
   uninitialized and representative populated state;
2. catalog authentication, migration rollback after every new DDL/data write,
   retry, constructor re-entry, disposal, and reopen;
3. all semantic receipt branches for claim, outcome recording, and completion,
   including replay/no-write behavior and the principal typed error edges;
4. nominal attempt/evidence authentication before field access plus
   representative malformed-group, counter, owner, and affected-row failures;
5. competing claims, outcome-versus-completion in both serial orders,
   completion with a newer pending generation, and one shared nine-operation
   conformance schedule; and
6. Node SQLite plus pinned local Workerd clock proof and one complete
   claim/outcome/completion/rollback/reopen lifecycle.

Claiming alone would create durable work that the adapter could neither settle
nor complete. A schema-only checkpoint would store facts without an owning
operation. All three methods and this base proof therefore land together in one
medium vertical. It may use several internally coherent commits, but review and
acceptance judge the complete vertical rather than a partial facade.

Later slices close exhaustive corruption/fault enumeration, repeated race and
conformance schedules, exact maximum/plus-one limits, and the final Workerd
matrix. C3 does not exit until that complete matrix passes.

## Capability And Naming Boundary

After all three methods exist, replace the chronological partial facade with
the plain current capability name accepted here:

```ts
type DeploymentQuerySyncState = QuerySyncTransitionState;
```

The factory becomes `makeDeploymentQuerySyncState`. It returns one frozen
plain value closed over one authenticated binding, one object-local SQLite
capability, and the production publication-instant reader. Current concrete
consumers are backend tests and Workerd proof workers; no production or public
consumer has been found. Update those consumers and remove the displaced
`DeploymentQuerySyncEvaluationState` and
`DeploymentQuerySyncEvaluationStateInput` names. The construction input becomes
`DeploymentQuerySyncStateInput`. Do not retain an alias merely for tests, and
do not add `V4` to the product or capability name.

The storage generation remains versioned because it is a persisted
compatibility contract. The product and accepted current implementation do
not.

The adapter is intentionally a dynamic multi-instance plain value. Many
Durable Object instances coexist, so it is not a module global, application
singleton, `Context.Service`, or global Layer. A later FX02 host composition
root may own shared stateless capabilities, but it must preserve per-object
binding and storage cardinality.

## Proposed Module Ownership

Keep one domain under `packages/flarex-backend/src/deploymentSync`:

| Module | Responsibility |
| --- | --- |
| `Store.ts` | final nine-operation composition root plus initialize, begin, and admitted-batch operations |
| `EvaluationState.ts` | completion, evaluation claiming, and evaluation-attempt outcomes; generation 4 reads real target lifecycle facts |
| `PublicationState.ts` | only the three planner-driven publication transaction programs |
| `PublicationStorage.ts` | bounded publication/lifecycle/owner reads and exact physical writes; no semantic policy |
| `PublicationRowCodec.ts` | pending, in-flight, and lifecycle persistence rows; canonical decimal attempt instants |
| `PublicationClock.ts` | the exact synchronous SQLite instant read and a separate package-local deterministic test seam |
| `StorageContractGeneration4.ts` | exact generation-4 catalog, fresh construction, predecessor migration, and readiness |
| `StorageContract.ts` | generation classification and dispatch through generation 4 |
| `StateStorage.ts` | shared transaction, scope, chunking, and affected-row mechanics only |

Dependencies remain one-way: `Store.ts` composes the state-operation modules;
`PublicationState.ts` consumes the portable planners and publication storage;
`EvaluationState.ts` may consume only the target-lifecycle read projection;
`PublicationStorage.ts` consumes its row codec and shared storage mechanics;
and neither storage module imports a state-operation module. Generation modules
remain predecessor/contract authorities and do not import operation policy.

Move the existing pending-publication row codec from `EvaluationRowCodec.ts`
to `PublicationRowCodec.ts` because generation 4 gives that representation a
real publication-domain owner. `EvaluationState.ts` continues to consume that
codec when completion creates or replaces pending intent. Do not move query
completion codecs or create a generic database utility layer.

`DeploymentSyncDO` remains an empty production-inert shell. No C3 module may
import a publisher, Postgres source, WebSocket, Durable Stream, route, alarm,
or runtime runner.

## Generation-4 Physical Contract

Retain the five generation-3 tables and the dependency reverse index exactly:

1. `deployment_sync_contract_state`;
2. `deployment_sync_scope_state`;
3. `deployment_sync_queries`;
4. `deployment_sync_query_dependencies`;
5. `deployment_sync_pending_publications`; and
6. `deployment_sync_query_dependencies_reverse`.

Generation 4 adds exactly two `STRICT, WITHOUT ROWID` singleton tables.

### Immutable in-flight publication

`deployment_sync_in_flight_publication` contains:

- `singleton INTEGER PRIMARY KEY CHECK (singleton = 1)`;
- canonical `query_key`;
- canonical decimal-text `generation`;
- canonical `query_identity`;
- canonical decimal-text `completed_through_sequence`;
- canonical `result_digest`; and
- canonical publication `content`.

The row is absent or singular. It contains only the immutable retained
publication. Attempt-outcome DML never binds, compares, or rewrites the
maximum-size content body; the portable planner still validates the decoded
publication against the authenticated nominal attempt.

### Small publication lifecycle state

`deployment_sync_publication_state` contains one row for every initialized
scope and no row for an uninitialized contract. Its groups are:

- `singleton INTEGER PRIMARY KEY CHECK (singleton = 1)`;
- nullable all-or-none in-flight metadata: ordinal, canonical decimal-text
  first/last attempt instants, disposition, and optional block reason;
- nullable all-or-none latest-delivered scope-relative identity (query key and
  generation) and result digest; and
- nullable all-or-none preceding-outcome scope-relative identity, result
  digest, ordinal, outcome, receipt tag, and the receipt branch's next
  ordinal/disposition or block reason.

The stored spellings match the closed portable unions. Group constraints prove
null coherence and branch coherence. A blocked disposition or blocked receipt
requires one of `terminalPublisherRefusal`, `attemptLimitReached`, or
`ageLimitReached`; `resetRequired` is reconstructed as the portable constant
`true` rather than redundantly stored. A recorded receipt requires its next
ordinal and `ready` or `uncertain` disposition and forbids a block reason.

The lifecycle row and in-flight row must either both describe one in-flight
attempt or both describe none. Their presence must agree with
`in_flight_publication_count`. The decoded lifecycle contribution must agree
exactly with `settlement_envelope_bytes`. Retained-content and total-counted
metrics must be at least the exact in-flight retained-content contribution and
the combined in-flight-plus-lifecycle counted contribution, respectively,
because those totals also include pending publications and the rest of
canonical state. Operation deltas and the testing-only normalized snapshot
prove the complete metric totals exactly.

The split is deliberate: the in-flight content row changes only on claim and
completion, while retries update only the small lifecycle row and scope
metrics.

### Pending selection and indexes

Keep `deployment_sync_pending_publications` unchanged. Its `query_key` primary
key already proves one pending publication per query and supplies canonical
query-key order. Because authority fields are fixed by the bound scope and
there is only one row per query, this is the portable `(queryKey, generation)`
selection order. Use an explicit binary-order query and prove its plan under
Node SQLite and Workerd.

Add no speculative pending index, partial index, foreign key, trigger, or
second publication table family. If the pinned Workerd query-plan proof shows
that the primary key cannot satisfy the bounded selection, stop for an
explicit physical-contract amendment rather than silently adding an index.

## Fresh Construction, Migration, And Readiness

All readiness work runs synchronously in one host-owned transaction after
route/binding validation and before the adapter is returned.

### Fresh database

Create generation 4 directly. Insert only the contract singleton with
`local_contract_generation = 4` and `durable_initialized_history = 0`.
There is no scope, query, dependency, pending, in-flight, or publication-state
row. Fresh storage does not pass through another committed generation.

After C3 acceptance and implementation, the first authorized
`initializeOrInspectNamespace` transaction inserts the empty scope and empty
publication-state singleton and flips durable initialized history together.
Losing any one of those writes rolls back all of them.

### Exact generations 1 and 2

Reuse the existing authenticated generation-1/2-to-generation-3 migration
logic inside the same outer readiness transaction, then immediately perform
the generation-3-to-generation-4 extension before returning. There is no
intermediate commit, runtime generation-3 adapter, dual read, or compatibility
write. Fresh storage still creates generation 4 directly.

### Exact generation 3

Before DDL, authenticate the exact generation-3 catalog, contract, closed
binding, optional scope, initialized-history relationship, and the generation-
3 lifecycle-zero invariant. Then:

1. rebuild only the contract table with the generation-4 marker;
2. create the in-flight and publication-state singleton tables;
3. insert one empty publication-state row only when initialized scope exists;
4. preserve every scope, query, dependency, pending-publication, authority,
   cursor, and counter value exactly; and
5. authenticate the exact generation-4 catalog and readiness before commit.

This additive migration does not aggregate-load every populated query,
dependency, or pending row. It does not reinterpret or rewrite those rows.
Operation-local decoders retain responsibility for their declared
neighborhoods, while the testing-only normalized snapshot proves complete
maximum-population preservation.

Any fault leaves the exact predecessor catalog and rows readable. Retry after
a committed migration authenticates generation 4 and performs no compatibility
write. Unsupported, mixed, additive, malformed, or altered catalogs fail
closed; there is no `IF NOT EXISTS`, drop/reset, repair, fallback, or retained
generation-3 runtime path.

## SQLite Clock Authority

The Flarex SQLite adapter owns publication attempt time inside the same
`transactionSync` as the lifecycle decision. The accepted exact production
expression is:

```sql
SELECT
  strftime('%s', 'now') || substr(strftime('%f', 'now'), 4, 3)
    AS publication_attempt_instant
```

It returns canonical decimal millisecond text. The adapter reads exactly one
row and one property, validates the canonical non-negative decimal spelling,
proves the value is within the portable safe-integer range, converts once, and
captures one `PublicationAttemptInstant`. The same value is passed through the
whole planner call and stored again as canonical decimal text.

The expression was probed during this preflight against Node 24 `node:sqlite`
and the repository's pinned Miniflare/Workerd SQLite runtime; both returned one
canonical decimal-text millisecond value. The implementation must retain this
as an automated Node and genuine Workerd contract test.

Only `claimPublication` and `recordPublicationAttemptOutcome` read the clock.
`completePublication` does not. A package-local test construction seam may
provide a deterministic synchronous instant reader, but production construction
always uses the SQLite reader.

Do not use `Date.now`, Effect Clock, caller-supplied production time, async
work, a nested Effect runtime, or a second clock read inside the transaction.
Effect Clock remains correct for Effect-owned orchestration; it is not the
authority for durable transaction evidence.

An unexpected clock row, property-access failure, noncanonical value, SQL
programming error, or out-of-range platform time is an adapter/platform defect
that rolls back. It is not stored-state corruption and is not laundered into a
retryable domain error.

## One Synchronous Transaction Per Operation

Every publication method follows this shape:

```text
authenticate nominal caller capability when present
  -> transactionSync
       -> contract + bound scope
       -> one SQLite instant when clocked
       -> exact lifecycle rows
       -> planner-directed owner or pending read
       -> pure portable planner
       -> exact CAS writes, if any
       -> scope metrics last
       -> fully consume/detach/freeze rows
  -> committed receipt
```

No callback contains `await`, network I/O, source reads, query execution,
publication delivery, alarm/wake work, another state operation, Effect runtime
execution, or a transaction/cursor escape. Pure row decoding and planner
composition use Effect v4 `Result`. Reusable state methods remain named
`Effect.fn` operations around the one transaction bridge.

### `claimPublication`

Read scope, one SQLite instant, and lifecycle state first.

- Existing in-flight state has precedence. Point-read its immutable row and
  owner query, then return blocked, replay its persisted ordinal/instants, or
  atomically age-block the small metadata row and scope metrics.
- With no in-flight state, read the lowest pending row in canonical order and
  its owner query. Empty and counter-inconsistent selections remain distinct.
- A fresh claim CAS-deletes the exact pending row, inserts the immutable
  in-flight singleton, installs ordinal `1`, first/last instant, and `ready`
  metadata, then replaces all eight scope metrics.

Latest-delivered and preceding-outcome facts remain byte-for-byte unchanged.
Settlement-envelope capacity is reserved before exposing the nominal attempt.

### `recordPublicationAttemptOutcome`

Authenticate the nominal `PublicationAttempt` before reading any of its
fields. Then read scope, one SQLite instant, full lifecycle state, the immutable
in-flight row when present, and the authenticated owner query.

Exact retained replay, conflicting replay, older evidence, superseded,
expired, and already-blocked branches perform no DML. A write CAS-replaces
only attempt ordinal/last instant/disposition and the complete preceding-
outcome receipt group, followed by exact scope metrics. Immutable content and
latest-delivered evidence do not change.

The portable planner retains terminal-refusal, ordinal-128, inclusive
seven-day age, backward-clock clamping, `ready`, and `uncertain` precedence.
SQL must not reproduce those decisions.

### `completePublication`

Authenticate nominal accepted evidence before reading any field. Read scope,
lifecycle state, the immutable in-flight row when present, and the owner query
required by the planner. Do not read the clock.

Replay and superseded branches perform no DML. Completion CAS-deletes the exact
in-flight singleton, clears in-flight metadata, installs latest-delivered
identity/digest, preserves preceding outcome, and replaces exact scope metrics.
It never deletes pending work; claim already moved the older publication, and
a newer pending generation may coexist.

### Existing operations under generation 4

`initializeOrInspectNamespace` owns empty lifecycle-row creation as described
above. `completeQueryEvaluation` must replace generation 3's hardcoded all-null
lifecycle projection with a real target-only projection:

- global lifecycle entries belonging to another query project as `null`;
- a target in-flight entry reads its immutable publication row;
- target latest-delivered and preceding-outcome facts project identity/digest;
  and
- missing, crossed, or counter-inconsistent rows are corruption.

This read is required so completion cannot remove or replace pending work using
false lifecycle facts once C3 state exists. The other four existing operations
retain their declared bounded read sets and semantics.

## Exact Writes And Error Boundary

Every physical write uses the plan's expected facts, exact old-row predicates,
and affected-row verification. The scope metric CAS remains the final logical
write. A failed predicate is an adapter invariant failure that rolls back; it
is not normal contention inside one serialized object-local transaction and it
does not create a second OCC system.

Preserve the existing closed Effect channels:

- portable domain/authority/limit failures remain their exact typed errors;
- malformed admitted stored rows and inconsistent cross-links become
  `QuerySyncStoredStateCorruptError` with `notCommitted` certainty;
- unsupported local generations become
  `QuerySyncStoredStateIncompatibleError`;
- only a positively recognized platform condition with documented rollback
  could become typed unavailability; C3 adds no message-based classifier or
  retry loop;
- unknown commit outcome is never fabricated for synchronous SQLite; and
- SQL programming errors, unexpected driver/property/cursor failures, clock
  defects, planner invariants, interruption, and cancellation retain their
  full defect/Cause semantics.

Response-loss test wrappers may inject unknown outcome after a committed state
operation to prove semantic replay. They must not change the real adapter's
failure classification.

## Implementation And Proof Sequence

Under this accepted checkpoint, use this sequence. Each step is a focused
commit or reviewable checkpoint, but none individually exits C3.

### 1. Medium generation-4 lifecycle vertical and base proof

**Status:** complete in the current implementation checkpoint.

- catalog, predecessor migration, readiness, and codecs;
- exact SQLite clock;
- all three publication operations;
- real completion-lifecycle projection;
- exact nine-operation facade and private naming cleanup;
- fresh and generation-1/2/3 migration, catalog, rollback, retry, re-entry, and
  reopen proof over uninitialized and representative populated state;
- all semantic publication receipt branches, principal typed failures, nominal
  capability checks, and representative corruption/affected-row proof;
- representative competing histories and one shared nine-operation conformance
  schedule; and
- Node SQLite plus pinned local Workerd clock and complete lifecycle proof.

No intermediate exported facade may claim work without outcome and completion
methods.

### 2. Exhaustive catalog, corruption, and transaction closure

**Status:** complete in the current implementation checkpoint.

- populated generation-3 preservation at real limits;
- altered, additive, mixed, unsupported, malformed, and lifecycle-impossible
  predecessor refusal;
- exhaustive partial-group, missing/excess-row, noncanonical-text, wrong-owner/
  generation/digest, crossed-link, and counter-corruption matrices;
- ordinal and seven-day boundaries plus clock regression;
- no-write read traces and no armed write-fault consumption; and
- failure before every remaining publication-operation logical write plus exact
  affected-row mismatch; every predecessor-refusal case leaves its catalog and
  rows unchanged.

### 3. Repeated cross-operation and conformance closure

**Status:** complete in the current implementation checkpoint.

- claim versus a new query completion;
- publication completion versus exact-next invalidation;
- response loss before and after commit; and
- repeated seeded nine-operation schedules comparing every receipt and
  testing-only normalized snapshot with the reference oracle.

### 4. Limits and genuine Workerd exit

- 4,096 pending publications, one in-flight publication, and one newer pending
  publication behind that in-flight query;
- 1 MiB content, 32 MiB retained publication content, settlement-envelope
  reservation, 64 MiB counted canonical state, ordinal 128, and exact
  maximum/plus-one behavior;
- Node SQLite and pinned Workerd clock, row, binding, query-plan, rollback,
  buffering, namespace-isolation, disposal/recreate, and persisted reopen; and
- no overclaim that Miniflare disposal proves deployed Cloudflare eviction or
  hibernation.

## Exit Matrix

| Proof family | Required evidence |
| --- | --- |
| authority and exports | exact private `QuerySyncTransitionState`; no package-root/backend export, new package/dependency, host route, or reference-store fallback |
| generation | fresh/1/2/3 to exact generation 4; populated generation-3 preservation; mixed/unsupported/corrupt refusal before mutation |
| transaction | one synchronous transaction; one portable planner; exact CAS/counters; every staged-write fault restores the prior state |
| clock | one validated SQLite instant per clocked operation; deterministic test seam; no platform/Effect/caller clock substitution |
| claim | in-flight precedence, canonical pending selection, atomic move, settlement reservation, exact blocked/replayed/none no-write behavior |
| outcome | nominal authentication, retained replay/conflict, ordinal/age/terminal precedence, clamping, superseded/expired windows |
| completion | nominal evidence, identity/digest check, blocked/uncertain acceptance, latest-delivered replay, newer-pending and preceding-outcome preservation |
| existing completion | target-only lifecycle projection prevents incorrect pending replacement while in-flight/delivered evidence exists |
| cross-operation | every competing history equals one complete serial history |
| corruption/read trace | partial/noncanonical/crossed/counter-inconsistent state fails closed; terminal branches perform no later reads or writes |
| limits | exact maxima succeed; plus-one fails before exposure/mutation; post-claim settlement remains capacity-infallible |
| conformance | shared nine-operation histories match every receipt and normalized snapshot |
| Workerd lifecycle | pinned real Workerd catalog/clock/rollback/reopen proof with honest eviction labeling |

## Eviction And Hibernation Decision

The existing B/FX01 wording asks C3 for explicit eviction/reopen proof, but the
current local harness can directly prove persisted disposal/recreation,
constructor re-entry, and reopen—not a deployed Cloudflare eviction event.

The accepted decision is:

- keep disposal/recreate/reopen as mandatory C3 adapter exit evidence;
- do not relabel it as eviction or hibernation; and
- move deployed eviction/hibernation proof to FX02, where a real
  `DeploymentSyncDO` host composition and caller lifecycle exist.

This accepted checkpoint explicitly supersedes only the older claim that the
storage-only C3 adapter can prove a deployed host eviction. If an approved
current Workerd harness exposes a genuine eviction control before C3 exits,
add that evidence without changing semantic scope.

## Explicitly Not Authorized

This checkpoint does not authorize:

- a change to portable query-sync semantics, state signatures, planners,
  limits, or orchestration; a discovered core defect requires its own owning
  preflight and approval;
- a real `ResultPublisher`, Electric/Durable Streams selection, DeliveryDO,
  stream, queue, WebSocket, gateway, subscription, SDK, or fanout;
- `DeploymentSyncDO` RPC/fetch/alarm/scheduled behavior, host composition,
  production routing, or a production fresh-initialization mint;
- Postgres `ReplayableChangeSource`, catch-up, wake, checkpoint, retention,
  query execution, evaluator composition, or application-runtime receipt
  changes;
- a second actor, engine, registry, cursor, table family, aggregate blob, dual
  write, shadow comparison, fallback, repair, reset, or compatibility path;
- OCC, commit compilation/execution, transaction journals, idempotency,
  authoritative application rows, commit publication, or application outbox
  changes;
- reset/release/eviction semantic operations outside the existing
  nine-operation port;
- a public package/API/SDK, Legacy cutover, `QSYNC-FX02`, `QSYNC-FX03`,
  `QSYNC-CF01`, `R03-B`, `SV-R Live`, runtime-portability, deployed-
  Cloudflare, production-readiness, or product-parity claims.

## Accepted Checkpoint

Accepted on 2026-08-31 with these decisions:

1. generation 4 with separate immutable in-flight and small lifecycle
   singleton tables;
2. the exact SQLite text-millisecond clock and defect boundary;
3. one medium implementation-and-base-proof vertical containing all three
   operations plus the final unversioned private facade name; and
4. honest C3 reopen proof with deployed eviction/hibernation deferred to FX02.

The medium implementation-and-base-proof vertical plus phase-2 and phase-3
closure are complete. `QSYNC-FX01-C3` remains incomplete and production-inert
until the remaining phase-4 exit proof passes.
