# QSYNC01-C Effect Orchestration Preflight

## Status

**Preflight status:** accepted umbrella architecture. `QSYNC01-C1` is complete
in commit `b6621cf3`. The exact C2 contract is proposed separately in
[`04-qsync01-c2-durable-work-and-publication-state.md`](./04-qsync01-c2-durable-work-and-publication-state.md).

The original approval authorized **C1 only**. C2, C3, and C4 each require a
separate explicit user implementation approval after the preceding slice and
its evidence are reviewed; the umbrella architecture is not standing authority
to implement all four slices at once.

`QSYNC01-A` and `QSYNC01-B` are complete, private, and production-inert. They
provide the pure transition oracle, admitted change source, nominal refresh
evidence, receipt-only semantic state port, and deterministic reference
capabilities. They do not yet provide a retry-safe evaluation lifecycle,
publication outbox, query evaluator, publisher, or orchestration turn.

## Decision

`QSYNC01-C` remains part of the same independent private
`@flarex/query-sync` framework. It is not a Cloudflare feature and it does not
move into `flarex-backend`. The gate is implemented in four ordered slices:

1. **`QSYNC01-C1` -- evaluation transaction recovery.** Replace the two unsafe
   B operations with a stale-safe begin fence and complete-request fingerprint;
   atomically install a generation and its bounded pending publication intent.
2. **`QSYNC01-C2` -- durable work selection and publication attempt state.**
   Add revision-fenced provisional/dirty work recovery plus replay-safe
   publication claim, attempt outcome, completion, count, and age decisions.
3. **`QSYNC01-C3` -- one bounded evaluation orchestration turn.** Add a plain
   namespace-bound coordinator with Effect-native catch-up, evaluation,
   refresh-to-current, and rerun coalescing over the C1/C2 capabilities.
4. **`QSYNC01-C4` -- publication orchestration and full conformance.** Add a
   separate generic publication coordinator, exact-publication retry/recovery,
   and the complete restart, uncertainty, deadline, and competing-turn matrix.

The first medium implementation slice is `QSYNC01-C1`. Building either durable
work schedulers or an async coordinator first is rejected: B deliberately
leaves begin and completion commit uncertainty unresolved, so later control
flow written directly against the B port would either contain a blind retry or
make a transient receipt the publication authority.

A catch-up-only coordinator is independently possible over B, because
initialize and exact-sequence apply can be semantically reconciled. It is not
the first slice because it would freeze orchestration around a state port that
must immediately change for safe query work. The state/oracle contract is the
dependency; orchestration follows it.

## Completed Baseline And Unsafe Seams

The accepted B boundary already owns:

- raw and admitted replayable source pages, retention/reset outcomes, caught-up
  authority, projection budgets, and precise source errors;
- pure generation-refresh admission over one complete post-snapshot interval;
- namespace initialization/inspection, provisional generation begin,
  exact-next invalidation application, and generation completion;
- exact namespace/model/epoch/query/generation/cursor/witness validation;
- a reference source and serialized reference state adapter with before-commit
  and after-commit fault injection; and
- conformance histories comparing the semantic port with the pure oracle.

The B port is intentionally not the final durable-adapter contract:

| B operation | Definite rollback | Unknown commit outcome |
| --- | --- | --- |
| initialize/inspect | exact retry is safe | re-inspection recovers the current binding/cursor |
| apply exact batch | exact retry is safe | replay becomes `applied` or `duplicate`; affected-query receipt is not authority |
| begin generation | exact retry is safe while the same provisional remains | unsafe: completion may clear the slot and a blind retry may allocate the next generation |
| complete generation | exact retry is safe before commit | unsafe: success clears the provisional and loses the transient `publicationRequired` decision |

`QSYNC01-C1` must remove the last two holes before a real state adapter exists.
It must not hide them with an aggregate read, generic transaction callback,
caller-side Boolean, timeout retry, or second-transaction outbox write.

## Authority And Production-Inert Cut

The portable engine owns:

- the semantic identity of one evaluation work item;
- stale-safe generation allocation and replay classification;
- monotonic dirty-frontier and rerun coalescing decisions;
- the atomic decision to install a generation and create or suppress a query
  result publication;
- the immutable identity and content of pending publication work;
- bounded selection, replay, and completion of that publication work;
- portable orchestration outcomes, typed failures, budgets, and continuations;
  and
- deterministic reference capabilities and conformance histories.

Existing owners retain:

| Owner | Responsibility retained outside C |
| --- | --- |
| trusted application/model adapter | query decoding, query execution, snapshot authority, dependency/result construction, digest and witness construction |
| `@flarex/persistence-postgres` | authoritative commit feed, retained floor, source epoch, query snapshot facts, application rows, and existing commit outbox |
| `flarex-protocol` | Flarex-specific persisted/wire frames and codec versions |
| `flarex-backend` | per-scope Durable Object construction, SQLite transactions, alarms/wakes, bindings, auth, runtime runners, and delivery composition |
| accepted delivery adapter | append/read protocol, producer storage, transport offsets, remote retention, and exact acceptance evidence |
| client/gateway owners | principal authorization, subscription lifecycle, reconnect, reset, transport, and SDK behavior |

No C slice changes OCC, commit compilation or execution, transaction journals,
idempotency outcomes, application-row semantics, commit/change-feed behavior,
or the existing application outbox. The query-result publication outbox is a
separate engine-owned semantic record fed by those existing authorities.

## Package, Files, Exports, And Dependencies

The work stays in the existing private package. C1/C2 change only the pure,
state, and reference boundaries. C3 is the first slice allowed to create the
orchestration domain:

```text
packages/query-sync/
  src/
    kernel/                    # C1/C2 pure values, aggregate, decisions
    change/                    # completed B admission; reused
    state/                     # C1/C2 semantic ports, receipts, failures
    orchestration/             # added only by C3
      Model.ts
      Errors.ts
      Ports.ts
      CatchUp.ts
      Evaluation.ts
      Coordinator.ts
      index.ts
    testing/
      conformance/             # C1-C4 reference targets and histories
  test/
```

After C3, at most one new package export is allowed:

```json
{
  "./internal/orchestration": "./src/orchestration/index.ts"
}
```

There remains no package-root export. `./internal/kernel`,
`./internal/change`, `./internal/state`, and testing subpaths remain private
package seams. C must not add another package, a Cloudflare/Postgres subpath,
or a client-facing export.

The only runtime dependencies remain `effect` and already-proven
dependency-leaf primitives from `@flarex/utils`. C must not import Flarex
packages, Cloudflare types, a database driver, an Electric/Durable Streams
package, a network framework, or an application row/relation type.

### Exact C1 file plan

C1 is authorized to add exactly:

- `packages/query-sync/src/kernel/Publication.ts` for portable publication
  content/identity/state values and their pure capture helpers;
- `packages/query-sync/test/evaluationTransactionRecovery.test.ts`; and
- `packages/query-sync/test/atomicPublicationIntent.test.ts`.

C1 may modify exactly:

- `src/kernel/CanonicalValue.ts`, `Errors.ts`, `Model.ts`, `Policy.ts`, and
  `index.ts`;
- `src/state/Errors.ts`, `Port.ts`, `Receipts.ts`, and `index.ts`;
- `src/testing/ReferenceModel.ts` and `src/testing/index.ts`;
- `src/testing/conformance/ReferenceStateStore.ts`, `StateConformance.ts`, and
  `index.ts`;
- `test/fixtures.ts`, `queryGenerationPolicy.test.ts`,
  `invalidationPolicy.test.ts`, `referenceModel.test.ts`,
  `referenceStateConformance.test.ts`,
  `referenceStateExtendedConformance.test.ts`,
  `referenceStateAtomicity.test.ts`, `receiptOwnership.test.ts`, and
  `isolationAndDeterminism.test.ts` only where their private state/receipt
  expectations change.

No C1 package export is added. A need for another production source file,
test file, subpath, dependency, package manifest change, or package is a
preflight change, not an implementation convenience.

## Namespace, Model, And Trust Binding

Every state/source/evaluator/publisher/coordinator instance is already bound to
one authenticated namespace capability and one admitted static model. Every
operation still carries enough namespace, model, epoch, query, generation, and
cursor evidence for the state transaction to reject a crossed or stale value.

The generic engine never:

- chooses a tenant from browser/client input;
- loads tenant-authored executable model code;
- treats a wake, delivery offset, result payload, or publisher receipt as
  source-sequence authority;
- infers a digest or authority witness merely because bytes are present; or
- widens opaque application data into generic TypeScript row types.

`QueryEvaluator` and `InvalidationProjector` are trusted static adapter code.
Their outputs remain subject to the portable bounds and identity fences.
Unexpected model/evaluator throws are defects unless the adapter explicitly
maps an expected failure to its typed channel.

## C1 Evaluation Work Identity And Begin Recovery

The B `beginQueryGeneration(target)` state operation is replaced, not wrapped
by a Legacy dual path, with a stale-safe semantic begin request. The request
carries:

- the complete query target;
- `expectedActiveGeneration`, which is `null` for first registration and the
  exact active generation for a rerun; and
- a requested dirty frontier, or `null` for first registration.

The complete query identity plus `expectedActiveGeneration` is the immutable
compare-and-begin attempt fence. The requested dirty frontier is not attempt
identity: it is monotonic work attached to that fence. The state transaction
revalidates the identity/fence and may raise the attached work frontier, but it
can never lower it.

Valid outcomes are:

| Outcome | Meaning |
| --- | --- |
| `created` | expected active state still matches; one provisional generation was created |
| `replayed` | the same expected-active fence already owns the current provisional; return the same generation, registration cursor, and current coalesced dirty frontier |
| `alreadyAdvanced` | a later active generation/freshness frontier already supersedes the request; do not allocate |
| `notDirty` | the requested rerun frontier is already satisfied; do not allocate |

An after-commit response loss is therefore safe to resolve with the exact same
request. If the provisional still exists, the result is `replayed`, even when
a concurrent later request raised its dirty frontier; the older request is
subsumed by the returned current frontier. If another coordinator completed
it, the result is `alreadyAdvanced`. The stale expected-active fence can never
create the following generation.

The provisional record retains the expected-active generation and highest
requested dirty frontier. A request with inconsistent query identity or
expected-active generation fails closed. A lower/equal frontier replays the
current record; a higher frontier monotonically coalesces into that same
record. Neither case allocates a second provisional generation.

## C2 Durable Evaluation Work And Rerun Coalescing

Provisional and dirty state remain durable in the aggregate; the transient
begin/affected-query receipts are never recovery or scheduler authority. C2
adds one bounded semantic evaluation-work selection operation.

`claimEvaluationWork` treats an existing non-blocked provisional (including a
first registration whose begin response was lost) and a dirty active query as
one eligible work set. It scans that set in deterministic round-robin canonical
order beginning after a durable per-namespace fairness anchor and atomically
returns one of:

- `claimed`, containing the stale-safe evaluation request, provisional
  generation, registration cursor, and next scan continuation;
- `continued`, when the scan budget is exhausted before a claim;
- `scanRestarted`, when eligibility changed and a new fenced cycle is needed;
- `blocked`, only after one stable full wrap finds no claimable work but finds
  at least one durable blocked provisional, containing the canonical blocked
  query/generation and reset-required evidence;
- `none`, only when neither claimable nor blocked evaluation work exists in the
  scanned cycle; or
- an explicit capacity/corruption/incompatibility failure.

Selection recovers, creates, or replays the one provisional slot through the
same begin fence. A restart can therefore rediscover an active-null initial
provisional without the lost begin receipt or an aggregate read. It never
maintains an in-memory `rerunInFlight` or `rerunQueued` flag. If an invalidation
arrives during evaluation, the active dirty frontier moves monotonically to the
latest relevant sequence. Completion revalidates it; an obsolete candidate
returns `rerunRequired`, and the next claim coalesces to the latest durable
frontier.

A claim response with unknown commit outcome is not called a rollback. The
next recovery turn asks the state owner for current durable work. Re-executing
valid work is allowed; publishing or allocating from stale claim data is not.

C2 adds a precision-safe monotonic `workRevision` to the aggregate. Every
transition that can change evaluation-work eligibility increments it in the
same atomic state change. The aggregate also retains the last successfully
claimed query key as its fairness anchor. A scan continuation is tied to
namespace/model/epoch, the revision and anchor observed at scan start, the
last canonical query key inspected, and whether canonical wrap has occurred.

If the revision differs when a continuation resumes, state returns a
`scanRestarted` continuation beginning after the durable fairness anchor under
the new revision; it does not reset perpetually to the lowest key, finish only
the old suffix, or report idle. A successful claim advances the anchor to that
query. `none` is authoritative only after one bounded full wrap observes no
eligible or blocked query and the same `workRevision`/anchor from start through
the final transaction. `blocked` has the same stable-full-wrap requirement and
is returned only when no eligible query can be claimed, so operator visibility
cannot starve runnable work. Revision exhaustion is a typed terminal limit,
never wraparound.

Continuations remain progress evidence rather than query/work authority. This
revision-fenced round-robin rule may revisit work after concurrent change, but
it cannot permanently favor a continuously redirtied low key, skip a query
dirtied behind the prior scan position, or consume the only wake and
incorrectly declare the namespace idle.

C2 also adds `recordEvaluationAttemptOutcome`. A transient evaluator exhaustion
leaves the provisional eligible for a later round-robin turn. A terminal
evaluator refusal records a replay-safe per-query `blocked` disposition for the
exact generation and advances work revision. Later claims skip blocked entries
while eligible work exists, then return the restart-safe `blocked` outcome once
a stable full wrap finds only blocked work. Thus an after-commit response loss
cannot turn terminal failure into `none` or hide the required operator/reset
action. Clearing that disposition requires a separately authorized reset/re-
registration transition; it is never silently cleared.

## C1 Publication Artifact And Identity

C1 admits one portable publication content form: an owned canonical base64url
byte string with a decoded-byte maximum of 1 MiB. The capture boundary proves
canonical encoding, copies/owns the spelling, and rejects over-limit content
before it enters state.

An immutable external-result reference is deliberately deferred. It needs a
concrete authorization, retention, digest, and deletion owner and must not be
invented as a permissive string union merely to anticipate large results.

The trusted evaluator supplies:

- the existing `QueryEvaluationEvidence`;
- the bounded canonical publication content; and
- the result digest already bound into the evaluation evidence.

The evaluator/model owner is responsible for constructing the digest from the
same canonical result. Before completion, `resnapshotRequired` or
`rerunRequired` may legitimately reevaluate the same provisional generation at
a newer snapshot and produce different evidence, digest, and content. Once one
completion commits, state retains a complete semantic completion fingerprint.
It includes descriptor/identity, generation, expected-active fence,
registration cursor, requested dirty frontier, evaluation snapshot, dependency
set, evaluation and refresh witnesses, refreshed/relevant sequences, result
digest, and publication disposition. The trusted result digest is the content
binding; replay input can never replace the exact content already persisted
with a pending intent.

A replay for the current committed generation must match every fingerprint
field or fail with an invalid-completion-replay error. The portable boundary
does not silently recompute a model-specific digest with another codec.

The natural publication identity is the frozen tuple:

```text
(namespaceId, syncModelId, sourceEpoch, queryKey, queryGeneration)
```

The record also carries the complete query identity, completed-through source
sequence, result digest, and owned canonical content. No random transport ID,
delivery offset, or publisher sequence becomes the logical publication
identity. A later delivery adapter durably binds this identity to its producer
tuple without changing engine identity or minting another logical publication.

## C1 Atomic Completion And Publication Intent

The B completion operation is replaced by one semantic state operation that
receives the state-issued evaluation attempt returned by begin, evaluation
evidence, admitted refresh evidence, and the captured publication artifact.
The attempt carries the complete target, generation, expected-active fence,
registration cursor, and current coalesced dirty frontier; completion never
reconstructs those state-issued facts from evaluator input.

Inside one state transaction it revalidates:

1. bound namespace, model, and source epoch;
2. complete query key and identity;
3. provisional generation, expected-active fence, and registration cursor;
4. evaluation snapshot and candidate dependency set;
5. refresh cursor, relevant sequence, and authority witness;
6. the current namespace cursor and active dirty frontier;
7. publication content bounds and retry equality; and
8. aggregate query, dependency, outbox, and byte ceilings.

The transaction then performs exactly one decision:

- `refreshRequired`, `resnapshotRequired`, or `rerunRequired` leaves the active
  generation and publication state unchanged;
- clean equal-digest completion installs freshness/dependencies, clears only
  the exact provisional, and creates no publication;
- clean changed-digest completion installs the generation and creates the
  immutable publication intent in the same atomic transition; or
- replay after a committed completion returns the current exact completion
  receipt or the explicit `superseded` result and never mints another intent.

The transient B `publicationRequired: boolean` is removed as orchestration
authority. The durable outbox is the only publication-work authority. A
`superseded` replay is a safe equivalent to reconstructing an old Boolean:
the caller performs no delivery, while any still-required publication remains
discoverable through the outbox operations.

C1 has pending-only publication intent. For one query, a newer changed
completion may replace the older pending record because query sync is
latest-state work; a stale generation can never replace it. C1 has no claim or
in-flight variant.

C2 later extends this rule: once a publication is claimed or its append outcome
may be unknown, it is immutable and cannot be replaced, and at most one newer
pending publication for that query is retained behind it.

For each retained query, C1 keeps the current semantic completion
fingerprint/receipt and the immediately preceding completion identity
tombstone. A request for the current generation with altered evidence never
inherits its receipt. A request for an older generation returns only
`superseded` or `recoveryEvidenceExpired`; it cannot replay an old receipt or
mutate state. This is bounded by the existing query-count, dependency, and
aggregate-byte ceilings and requires no clock.

## C2 Publication Claim And Completion State

C2 adds pure/reference semantic operations even though external publication is
not called until C4:

| Operation | Atomic behavior | Replay behavior |
| --- | --- | --- |
| `claimPublication` | replay the current in-flight attempt, or choose the next pending record in canonical identity order and create attempt ordinal 1 | returns the exact same identity, digest, content, ordinal, and first-attempt instant while unresolved |
| `recordPublicationAttemptOutcome` | record one exact attempt ordinal as known-not-appended, outcome-unknown, or terminal; either expose the next ordinal or enter blocked disposition | exact ordinal/outcome replay returns the same receipt and never advances twice |
| `completePublication` | validate nominal exact-acceptance evidence for the in-flight identity/digest and mark it delivered | returns `completed`, `replayed`, or `superseded`; never completes another publication |

Only one publication is in flight per namespace in the initial portable
contract. This is conservative, bounded, and sufficient for exact uncertainty
proof. Increasing concurrency requires a later preflight with independent
in-flight identities and ordering evidence.

C2 also defines the nominal exact-acceptance evidence shape and a testing-only
constructor so the pure transition and reference state can be proved. No
production capability may mint that evidence until C4 adds `ResultPublisher`;
the future delivery adapter remains responsible for translating its exact
accepted/read-back proof into the nominal value.

The in-flight record durably stores `attemptOrdinal`, `firstAttemptAt`,
`lastAttemptAt`, the immediately preceding attempt outcome, and one of
`ready`, `uncertain`, or `blocked`. Instants are precision-safe Unix
milliseconds supplied by the state owner, not by a browser, wake, evaluator,
or publisher. The pure oracle receives that trusted instant explicitly; the
reference state adapter captures it from an injected Effect Clock, and a real
database adapter must use its transaction/database clock.

After a publisher failure, C4 records the exact ordinal and classification
before requesting the next ordinal. If the process dies before that record,
recovery reuses the same ordinal and exact publication; if the record response
is lost, exact replay cannot increment twice. Clock regression clamps to the
stored `lastAttemptAt` and cannot reduce age; the count ceiling remains an
independent stop.

At 128 recorded external attempts, seven days from `firstAttemptAt`, or a
terminal publisher refusal, the record enters fail-closed `blocked` disposition
and the coordinator returns `publicationResetRequired`/operator action. It is
not evicted, called delivered, or overtaken. Because C2 permits only one
namespace-wide in-flight record, blocked disposition intentionally blocks later
delivery until a separately authorized reset/reconciliation transition resolves
it. This is explicit backpressure, not silent loss.

C2 additionally keeps the latest delivered publication tombstone and the
immediately preceding attempt-outcome receipt. Removing a query, any unresolved
publication, or its completion/delivery tombstones remains part of the
separately gated release/reset transitions. The reference model must prove
these exact retained windows before any real adapter.

No network call occurs inside any state transaction.

## C1 And C2 Semantic State Ports

The private state port after C1 contains only the four semantic operations:

```text
initializeOrInspectNamespace
beginQueryEvaluation
applyAdmittedBatchAndAdvance
completeQueryEvaluation
```

C2 separately adds:

```text
claimEvaluationWork
recordEvaluationAttemptOutcome
claimPublication
recordPublicationAttemptOutcome
completePublication
```

It does not expose aggregate reads, driver CRUD, raw transactions, compare-and-
swap, cursor-only advance, arbitrary `save`, or generic callbacks. The B begin
and completion methods are removed from the private port when their C1
replacements land; there is no dual compatibility path because there is no
supported production consumer.

Every operation freezes:

- all values revalidated in the transaction;
- its natural idempotency/replay identity;
- definite rollback versus unknown outcome behavior;
- all unchanged-state decisions;
- bounded work/row/byte refusal;
- conflict, supersession, reset, corruption, and incompatibility behavior; and
- the exact operation-indexed integration error union that may escape.

### Exact C1 Effect channels

All C1 state methods capture their adapter dependencies and have custom
requirement channel `never`:

| State method | Success receipt tags | Expected error channel |
| --- | --- | --- |
| `initializeOrInspectNamespace` | existing B tags | existing B build/integration union |
| `beginQueryEvaluation` | `created`, `replayed`, `alreadyAdvanced`, `notDirty` | `BeginQueryEvaluationError \| QuerySyncStateIntegrationError<"beginQueryEvaluation">` |
| `applyAdmittedBatchAndAdvance` | existing B tags | existing B apply/integration union |
| `completeQueryEvaluation` | `refreshRequired`, `resnapshotRequired`, `rerunRequired`, `completed`, `replayed`, `superseded`, `recoveryEvidenceExpired` | `CompleteQueryEvaluationError \| QuerySyncStateIntegrationError<"completeQueryEvaluation">` |

C2's separate preflight freezes the exact channel table for
`claimEvaluationWork`, `recordEvaluationAttemptOutcome`, `claimPublication`,
`recordPublicationAttemptOutcome`, and `completePublication`, together with
their value outcomes, file ownership, limits, and recovery rules. C1 approval
is not authority to add them.

The C1 named domain unions include only operation-relevant authority,
collision, generation, completion-replay mismatch, publication-content,
canonical-value, and capacity/work-limit failures. State integration variants preserve
the B unavailable/contention/unknown/corrupt/incompatible/capacity taxonomy and
index the new operation names. Detailed tagged-error fields must be frozen by
the pure policy tests; no `unknown`, thrown domain error, or ad-hoc result union
may replace these channels.

## C3 Evaluation Coordinator Shape

C3 adds a plain factory, not a namespace Context tag:

```text
makeNamespaceQuerySync({
  binding,
  source,
  state,
  evaluator,
  policy
}) -> NamespaceQuerySync

NamespaceQuerySync.catchUp(turnBudget)
NamespaceQuerySync.beginQuery(target, turnBudget)
NamespaceQuerySync.runDirtyWork(continuation, turnBudget)
NamespaceQuerySync.recoverEvaluationWork(continuation, turnBudget)
```

Names describe the internal responsibility and are frozen only when C3 is
approved. The factory captures one namespace-bound source, state adapter,
evaluator, and immutable policy. Returned operations are named `Effect.fn`
values whose custom requirement channel is `never`; dependencies are supplied
at construction. A later application-scoped registry/factory may be a Context
service, but the many namespace instances are not singleton services.

C3 creates no Layer, Scope, Fiber, runtime, or runner. It performs one caller-
driven bounded turn and returns a continuation. A real Worker fetch/alarm/queue
handler remains the only owner allowed to run the Effect or schedule another
turn.

## C3 Catch-Up State Machine

`catchUp` is sequential and preserves source order:

1. initialize or inspect the bound aggregate;
2. read one admitted page after the exact durable cursor;
3. on a page, apply each admitted batch in sequence through the semantic state
   operation;
4. accept `duplicate` only as recovery of the exact observed sequence;
5. stop without fabricated progress on gap, history loss, epoch replacement,
   budget shortfall, or reset;
6. repeat while `hasMore` and total turn budget remains; and
7. return `caughtUp` only when the final admitted page's authority sequence is
   exactly the durable applied-through cursor.

Wakes and source hints may cause this inspection but never change a cursor.
The loop does not use `Effect.all`; pages and state transitions are ordered.
It does not depend on the transient affected-query receipt, because dirty state
was committed with cursor advancement.

Catch-up outcomes distinguish:

- `caughtUp` with exact cursor/authority;
- `continuationRequired` with cursor and remaining-work reason;
- `budgetInsufficient` for an indivisible next unit;
- `historyUnavailable`;
- `epochReplaced`/`resetRequired`; and
- typed terminal state/source/model refusal.

## C3 Query Evaluator Contract

`QueryEvaluator` is a narrow namespace-bound plain capability:

```text
evaluate(attempt, evaluationBudget)
  -> Effect<QueryEvaluationArtifact, QueryEvaluatorError, never>
```

The attempt contains the complete query target, generation, registration
cursor, and expected-active/dirty fence returned by state. The artifact
contains captured `QueryEvaluationEvidence` plus the owned publication
content.

An admissible evaluator must:

- execute outside every engine state transaction;
- be read-only with respect to application authority and safe to reevaluate;
- obtain one coherent authoritative snapshot sequence;
- return dependencies, digest, result, and authority witness for that same
  snapshot;
- reject crossed namespace/model/epoch/query/generation values; and
- classify expected unavailable/timeout/rejected outcomes without converting
  defects or interruption into domain failures.

When transient evaluator attempts exhaust the current turn, C3 returns a
continuation and leaves the provisional eligible. On a typed terminal evaluator
refusal, it first records the exact C2 blocked disposition for that generation,
then returns `evaluationBlocked` with operator/reset evidence and the normal
scan continuation. It does not leave a terminal provisional at the head of
every recovery cycle or silently clear it.

Flarex query execution, snapshot acquisition, row decoding, and versioned
result-envelope construction remain later adapter work.

## C3 Refresh-To-Current State Machine

After evaluation, the coordinator:

1. catches durable state up through one admitted final-page authority;
2. rereads admitted changes from the evaluation snapshot;
3. accumulates the exact contiguous interval and derives nominal refresh
   evidence only through `admitGenerationRefreshEvidence`;
4. attempts atomic completion;
5. on `refreshRequired`, extends/rebuilds the interval to the newly required
   durable cursor within the same fixed turn budget;
6. on `resnapshotRequired`, reevaluates the same durable provisional only if
   evaluation-attempt budget remains;
7. on `rerunRequired`, reevaluates/coalesces to the latest dirty frontier only
   within the query/turn budget; and
8. otherwise returns a continuation while leaving the provisional and dirty
   state recoverable.

History loss, epoch replacement, a noncontiguous interval, authority drift
outside the replayable cursor, or an incomplete page can never produce clean
refresh evidence. A continuously moving head causes bounded continuation, not
an unbounded spin and not a stale installation.

Evaluation artifacts do not become process-local recovery authority. If a
turn ends before atomic completion, a later turn replays the provisional and
may reevaluate. Persisting candidates for cross-turn reuse would be another
state/schema contract and is not authorized by C3.

## C4 Publication Coordinator And Recovery

C4 does not change the C3 evaluation factory. It adds a separate plain
namespace-bound publication factory:

```text
makeNamespacePublicationSync({
  binding,
  state,
  publisher,
  policy
}) -> NamespacePublicationSync

NamespacePublicationSync.runPublicationWork(turnBudget)
NamespacePublicationSync.recoverPublication(turnBudget)
```

The host may compose both coordinators for one namespace, but publication
recovery cannot become an optional branch inside C3 evaluation recovery. This
keeps evaluator and delivery failures, budgets, and lifecycle ownership
separate without changing either semantic state owner.

`ResultPublisher` is a namespace/authorized-destination-bound plain capability:

```text
publish(exactPersistedPublication, deliveryBudget)
  -> Effect<AcceptedPublicationEvidence, ResultPublisherError, never>
```

It receives only publication identity/digest/content read from the state
outbox. It cannot accept a newly evaluated transient artifact. Its successful
evidence is nominal and bound to the exact identity and digest so
`completePublication` cannot settle another record.

Publisher failure classes remain distinct:

- known not appended and transient;
- append outcome unknown;
- terminal rejection/incompatibility;
- exact acceptance; and
- defect/interruption.

Known-not-appended and unknown outcomes may retry only the identical persisted
publication and adapter producer tuple. Unknown does not mint a new logical
identity, producer epoch, or sequence. C4 initially permits only the one
in-flight publication selected by state; another publication cannot overtake
it while acceptance is unresolved.

Every non-successful publisher call is followed, when the caller still owns
control, by `recordPublicationAttemptOutcome` for the exact ordinal. A lost
process or lost state response is reconciled by replaying that ordinal. The
durable attempt-count/age policy, rather than an invocation-local retry count,
eventually enters the explicit blocked/reset-required disposition.

This contract does not accept Durable Streams. A later adapter preflight must
prove how its receipt/read-back evidence satisfies `AcceptedPublicationEvidence`.

## Effect Success, Error, And Requirement Channels

Reusable C3/C4 orchestration uses named `Effect.fn`. Pure capture, comparison,
and transition policies continue to use plain TypeScript and Effect v4
`Result` for recoverable value-level failures.

| Capability/operation | Success channel | Expected error channel | Custom requirements |
| --- | --- | --- | --- |
| state semantic operation | frozen semantic receipt | operation-indexed kernel/state integration union | `never` |
| admitted source read | admitted page/reset/budget outcome | admitted-source errors | `never` |
| evaluator | captured evaluation artifact | transient unavailable/timeout or terminal evaluator refusal | `never` |
| publisher | nominal exact acceptance evidence | not-appended, unknown, or terminal publisher failure | `never` |
| namespace coordinator operation | frozen progress/completion/reset/continuation outcome | closed union of the connected typed capability failures | `never` after factory construction |

Outcome decisions such as gap, reset, budget exhaustion, continuation,
refresh, resnapshot, rerun, idle, replay, and supersession remain values when
the caller is expected to branch. Corruption, incompatible persisted state,
invalid trusted evidence, and terminal adapter failures remain typed failures.
Unexpected throws, invariant defects, interruption, and cancellation preserve
their full Effect `Cause`.

There is no broad `catchAll`, Promise catch, or conversion of defects into
ordinary sync failures. `Effect.result`/`Exit` may be used only at a testing or
host boundary that owns the full cause.

## Retry, Cancellation, Timeout, And Commit Certainty

There is no `Effect.retry` around an entire catch-up, evaluation, or publication
workflow. Retry is operation-specific and bounded:

- a state error marked `commitCertainty: "notCommitted"` may retry the exact
  semantic operation;
- an unknown state outcome may only replay a C1/C2 operation whose semantic
  identity and receipt/recovery rules make that replay safe;
- source read transient failure may retry the same cursor/budget request;
- evaluator retry reevaluates the same provisional and never allocates a new
  generation;
- one controlled publisher call is made before recording the outcome for one
  durable attempt ordinal; a known-not-appended or unknown result is durably
  recorded before another ordinal may call the publisher, while crash or
  unknown-state recovery may physically replay the same ordinal and exact
  persisted publication; and
- corruption, incompatibility, capacity, reset, authority mismatch, and
  terminal rejection are not retry schedule inputs.

For state, source, and evaluator calls, the initial policy permits at most two
retries after the first attempt. Any delay uses Effect Clock and a bounded
schedule; tests use TestClock. Hosts may choose a lower count, including zero,
but may not exceed the portable hard maximum without a new preflight.

Publisher calls are excluded from that invocation-local retry policy. C4 makes
at most one controlled call before it records an outcome and may continue only
with the next state-issued ordinal. If the process or state response is lost
before that outcome is known durable, a later recovery turn may replay the
unresolved ordinal and therefore make another physical call. The exact
publication identity and ordinal remain the adapter's stable idempotency key;
this is recovery, not an invocation-local retry. The combined publish/record/
next-claim sequence is the retry unit, preventing a generic Effect retry from
making unrecorded external attempts.

The coordinator treats the turn deadline as a **new-work admission deadline**
and reserves settlement headroom before starting another unit. It does not
claim that a foreign call already in progress ends at that instant, and it does
not place a generic interrupting timeout around a state commit: only the adapter
can classify whether an interrupted driver operation definitely rolled back or
became uncertain.

The completed B admitted-source port remains
`readAfter(request, ChangeReadBudget)`; C3 neither adds a deadline parameter nor
claims that this unchanged capability receives one. The coordinator checks the
new-work deadline before entering a source read and retains its existing count/
byte bounds. Reference sources settle finitely. A real source adapter must be
constructed with and prove its own finite settlement policy, mapping an owned
timeout to the existing typed temporary-unavailable error while preserving
foreign defects and interruption.

The C3 evaluator and C4 publisher receive explicit `evaluationBudget` and
`deliveryBudget` values containing the remaining admissible call allowance and
own their typed timeout mapping. A publisher timeout is delivery uncertainty
unless the adapter proves no append. A state adapter must itself guarantee a
finite operation settlement bound and classify its own driver timeout by commit
certainty; that bound is proved in the later real-adapter preflight. The generic
coordinator checks before entry and awaits that classified settlement. It does
not wrap a possibly committing state operation in a generic timeout.

Structured interruption stops new work and leaves durable provisional, dirty,
and publication state recoverable. No detached Fiber survives the caller turn.

## Portable Boundedness

Existing A/B hard limits remain. C adds these initial hard ceilings:

| Dimension | C hard maximum |
| --- | ---: |
| inline canonical publication content | 1 MiB decoded bytes |
| pending publication records per namespace | 4,096 |
| pending publication content subtotal | 32 MiB, counted within the aggregate byte ceiling |
| in-flight publications per namespace | 1 |
| queued newer publication per query behind an in-flight record | 1 |
| state/source/evaluator capability attempts per unit | 3 total |
| invocation-local publisher retries for one issued ordinal | 0 |
| admitted source reads per coordinator turn | 32 |
| applied batches per coordinator turn | 4,096 |
| dirty queries claimed/evaluated per turn | 32 |
| concurrent query evaluations in C3 | 1 |
| evaluations/resnapshots for one query per turn | 2 |
| refresh source reads for one query per turn | 32 |
| publication deliveries per C4 turn | 32 |
| new-work admission window per turn | finite caller budget, no more than 60 seconds |
| durable publication attempts before blocked | 128 |
| durable publication age before blocked | 7 days |

The coordinator accepts a stricter immutable policy from the host. It rejects
zero, negative, non-finite, unsafe-integer, or above-hard-maximum budgets before
work. Count limits and the new-work admission deadline are enforced before
another unit starts; whichever expires first returns a frozen continuation or
outcome. An already-started state call may settle after the admission deadline
only within the adapter's separately proved finite settlement bound.

The 1 MiB inline target is intentionally below the evaluated delivery
candidate's approximately 1.9 MB value ceiling. It does not prove Durable
Streams compatibility; envelope overhead, real platform behavior, large-result
references, and cost remain `QSYNC-CF01` evidence.

## Reference And Conformance Plan

C1/C2 extend the immutable reference aggregate and serialized reference state
adapter before any asynchronous coordinator exists. C3/C4 then run their
separate evaluation and publication orchestration against only reference
capabilities.

At minimum, deterministic histories prove:

### Evaluation and dirty work

- first registration, same-fence replay, stale expected-active refusal, and
  no accidental successor after lost begin response;
- concurrent begin requests coalesce to one provisional generation;
- invalidation before begin, during evaluation, after refresh, and during
  completion preserves the latest dirty frontier;
- canonical dirty scanning, continuation resume, restart, and no permanent
  skip of a query dirtied behind a continuation;
- `refreshRequired`, `resnapshotRequired`, and `rerunRequired` never install or
  publish the rejected candidate; and
- unchanged digest replaces dependencies/freshness without an outbox record.

### Publication state

- changed completion creates exactly one stable identity/content record in the
  same atomic transition;
- an after-commit completion response loss replays/supersedes without a second
  publication;
- an unclaimed pending result may coalesce to the latest generation;
- a claimed/uncertain publication remains immutable while one newer result is
  retained behind it;
- claim response loss returns the exact same identity, digest, and content;
- completion response loss is idempotent; crossed/stale evidence cannot settle
  another record; and
- capacity refusal rolls back generation installation and outbox creation
  together.

### Orchestration and faults

- empty and multi-page catch-up, a head moving between pages, duplicate/gap,
  retention loss, epoch replacement, and indivisible budget shortfall;
- before-commit, after-commit, and competing-turn faults around every new state
  operation;
- evaluator transient/terminal failure, interruption, timeout, and restart;
- head movement during refresh until completion or bounded continuation;
- publisher known-not-appended, unknown-after-possible-append, exact replay,
  terminal rejection, interruption, and completion loss;
- no additional work after the TestClock deadline/settlement reserve; and
- namespace/model/epoch/query isolation under randomized command histories.

Tests may use `Deferred`, scoped Fibers, and TestClock to force races, but the
production coordinator remains caller-driven and fiber-free.

## Current-To-Target Classification

| Current artifact | C action |
| --- | --- |
| A pure policies/reference reducer | extend as the sole semantic oracle; do not create an orchestration-owned parallel state machine |
| B admitted source and refresh admission | reuse; do not reconstruct pages, caught-up authority, or nominal refresh evidence |
| B receipt-only state port | replace private begin/completion seam in C1; retain initialize/apply semantics |
| B reference state/source | extend and reuse for conformance |
| backend `deploymentSync/Policy.ts` and `Store.ts` | evidence only; no import, copied SQLite contract, or transactionSync leak |
| `connectionDO`/`schedulerDO` rerun flags and cached Effects | Legacy/host evidence only; no in-memory coalescing precedent |
| Postgres commit-wake outbox | separate owner and evidence only; do not reuse its SQL or identities |
| Effect task schedulers/lifecycle code | reuse bounded-turn and atomic-intent patterns, not their task IDs, leases, SQL, or policies |
| Flarex commit feed, scope clock, wake outbox | unchanged; later adapter inputs |
| `DeploymentSyncDO` and current prototype sync state | unchanged; no dual write/fallback/migration |

## Explicitly Not Authorized

Approval of this preflight or C1 does not authorize:

- a production caller, route, alarm, queue, scheduler, Durable Object, Worker
  runner, or background Fiber;
- a real SQLite, Postgres, PGlite, filesystem, network, or stream adapter;
- a schema, migration, DDL, table, column, index, persisted codec, or protocol
  frame;
- Flarex query execution, commit-feed mapping, active-head mapping, or result
  envelope;
- a Context tag or Layer per namespace/query/request/transaction/object;
- a generic transaction callback, aggregate read/save, raw CAS, or cursor-only
  state escape hatch;
- a Durable Streams/Electric dependency or adoption decision;
- a client gateway, authentication protocol, SDK, WebSocket, SSE, long poll,
  reconnect, resume, or reset API;
- release/expiry, destructive namespace reset, large-result external
  references, age/operator eviction of unresolved publication work beyond the
  exact pending-coalescing/tombstone rules, or concurrent publication claims
  without their own proved transition;
- changes to OCC, journals, commit execution, idempotency outcomes,
  authoritative application rows, existing feed, or application outbox;
- Legacy dual state, dual writes, fallback, migration, or current sync-engine
  cutover;
- `R03-B`, Payload integration, public relation APIs, or a claim that runtime
  portability is proven; or
- a real Cloudflare state adapter before all of C is complete and its adapter
  preflight is separately approved; or
- C2, C3, or C4 implementation merely because the umbrella architecture or C1
  is approved; every later slice needs separate explicit user approval.

## First Medium Implementation Slice: QSYNC01-C1

After explicit approval, C1 proceeds as one bounded significant code slice:

1. add bounded canonical publication content and natural publication identity;
2. add the stale-safe expected-active begin fence, monotonic requested-dirty
   frontier, and exact replay/advanced/not-dirty receipts to the pure policy;
3. add the complete semantic completion fingerprint, current receipt, and
   immediately preceding identity tombstone;
4. extend atomic completion so generation install and pending publication
   intent are one pure transition, replacing the transient publication Boolean
   as work authority;
5. prove equal-digest suppression, replacement of only an older unclaimed
   pending result, and all-or-nothing capacity refusal;
6. replace only the private B begin/completion state methods and their
   operations/receipts/errors;
7. extend the reference reducer, serialized reference state adapter, fault
   injector, and reusable conformance commands; and
8. prove before/after-commit uncertainty, stale retry after intervening
   completion, fingerprint mismatch, concurrency, capacity, and byte/count
   bounds across the exact state/oracle diff.

C1 adds no work revision, evaluation-work scan/claim, publication claim,
delivery-attempt state, Clock, `orchestration/` directory, evaluator, publisher,
loop, retry schedule, Layer, Scope, Fiber, runtime runner, real adapter, or
production caller. It is medium because it replaces one coherent semantic
transaction boundary and closes the two prerequisite uncertainty holes without
mixing them with scheduling or asynchronous control flow.

Only the exact C1 files listed in the package plan are owned. No file under
`flarex-backend`, `flarex-protocol`, persistence, or another roadmap owner is
implementation scope.

## Validation And Review Gate

Every significant C slice must pass:

- `pnpm --filter @flarex/query-sync typecheck`;
- the full `@flarex/query-sync` test suite plus focused new conformance tests;
- forbidden-import, package-export, dependency-leaf, and runtime-boundary
  audits;
- ownership inspection proving no transient receipt or process-local flag is
  durable work authority;
- uncertainty inspection proving no broad retry and no unknown-as-rollback
  conversion;
- `pnpm lint:core`;
- `pnpm lint:diff`;
- `git diff --check`;
- both standing reviewers against the final significant diff; and
- `pnpm lint:diff -- --staged` against the exact intended index before commit.

If reviewer-driven code changes alter the significant diff, rerun both standing
reviewers. Real database/Cloudflare evidence is not claimed by reference C
slices and is required later by the adapter gates.

## Exit And Next Gates

`QSYNC01-C1` exits only when the pure oracle and reference semantic port prove
stale-safe begin, full completion-fingerprint replay, atomic generation install
plus pending publication intent, unchanged-result suppression, and no duplicate
intent after unknown completion. Its completion does not make C or a real
adapter complete.

`QSYNC01-C2` separately requires explicit user approval for durable
evaluation-work selection and publication attempt/completion state. C3 then
separately requires approval for the bounded evaluation coordinator. C4
separately requires approval for the publication coordinator and full
reference fault matrix. This umbrella preflight is not advance implementation
authority; every significant diff also requires the validation and reviewer
gate.

Only after C1-C4 are complete may `QSYNC-FX01` preflight the first Flarex and
Cloudflare SQLite adapters. `QSYNC-CF01` remains an independent delivery
feasibility spike. `R03-B` remains blocked through the later Flarex adapter,
delivery/client, restart, and target-only recovery proofs; C alone does not
unblock it.
