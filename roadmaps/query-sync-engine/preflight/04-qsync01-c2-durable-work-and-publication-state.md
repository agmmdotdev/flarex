# QSYNC01-C2 Durable Work And Publication State Preflight

## Status

**Preflight status:** approved and implemented on 2026-08-28. The package
remains private, runtime-neutral, reference-backed, and production-inert.

`QSYNC01-C1` is complete in commit `b6621cf3`. It established stale-safe
evaluation begin recovery, complete-request fingerprints, atomic generation
installation plus pending publication intent, and the reference uncertainty
proof. This preflight freezes the separately gated C2 contract that the C
umbrella deliberately left open.

Approval of this document authorizes C2 only. It does not authorize the C3
evaluation coordinator, C4 publication coordinator, a real state adapter, a
publisher, or Cloudflare/Flarex integration.

## Decision

C2 adds durable selection and attempt state to the same private,
runtime-neutral `@flarex/query-sync` framework:

1. revision-fenced, bounded, round-robin evaluation-work selection;
2. replay-safe terminal evaluation blocking;
3. one namespace-wide immutable in-flight publication;
4. replay-safe publication attempt outcomes, count/age blocking, and exact
   acceptance completion; and
5. the pure oracle, reference state adapter, and conformance evidence for
   those five semantic state operations.

C2 does **not** add an evaluation lease. A claim has no owner token, deadline,
renewal, expiry, or steal transition. An unknown claim response may cause valid
work to be selected and evaluated again; C1's generation and completion fences
prevent stale installation. Publication state also has no expiring lease: an
unresolved publication remains immutable and count-, age-, or terminal-blocked
until a separately authorized reset/reconciliation transition.

## Authority And Package Boundary

C2 stays inside `packages/query-sync`. Pure state values and transitions use
plain TypeScript and Effect v4 `Result`. The reference state operations remain
named `Effect.fn` functions over one harness-owned `SynchronizedRef`.

The namespace-bound state instance remains a plain multi-instance capability.
No Context service or Layer is justified: several namespace bindings may
coexist, the reference capability is lifecycle-free, and C2 introduces no
resource, background process, or runtime bridge.

The state owner is the only time authority for publication attempts. The pure
oracle receives a captured trusted instant explicitly. The reference adapter
reads `Clock.currentTimeMillis`; a future database adapter must read its
transaction/database clock. The state port accepts no caller-supplied time.

There is no network call in a C2 state operation.

## Exact File And Export Plan

C2 may add exactly:

- `packages/query-sync/src/kernel/EvaluationWork.ts`;
- `packages/query-sync/src/kernel/PublicationWork.ts`;
- `packages/query-sync/test/evaluationWorkSelection.test.ts`; and
- `packages/query-sync/test/publicationAttemptState.test.ts`.

C2 may modify exactly:

- `src/kernel/CanonicalValue.ts`, `Errors.ts`, `Model.ts`, `Policy.ts`,
  `Publication.ts`, and `index.ts`;
- `src/state/Errors.ts`, `Port.ts`, `Receipts.ts`, and `index.ts`;
- `src/testing/ReferenceModel.ts` and `src/testing/index.ts`;
- `src/testing/conformance/ReferenceStateStore.ts`, `StateConformance.ts`, and
  `index.ts`;
- `test/fixtures.ts`, `canonicalValue.test.ts`,
  `queryGenerationPolicy.test.ts`, `invalidationPolicy.test.ts`,
  `evaluationTransactionRecovery.test.ts`, `atomicPublicationIntent.test.ts`,
  `referenceModel.test.ts`, `referenceStateConformance.test.ts`,
  `referenceStateExtendedConformance.test.ts`,
  `referenceStateAtomicity.test.ts`, `receiptOwnership.test.ts`, and
  `isolationAndDeterminism.test.ts` only for the connected C2 state, receipt,
  invariant, and uncertainty expectations; and
- this preflight plus `roadmaps/query-sync-engine/README.md` and the C umbrella
  status record only for preflight linkage/status and later implementation
  receipts.

No package manifest, lockfile, package export, package-root export, dependency,
or package is added. Existing private kernel, state, and testing subpaths are
extended in place. A need for any other production file or test file is a
preflight amendment, not implementation convenience.

## Current-To-Target Classification

| Current artifact | C2 action |
| --- | --- |
| C1 `QuerySyncState` | extend as the sole aggregate; do not create scheduler-owned state |
| C1 provisional and dirty frontiers | retain as durable evaluation-work authority |
| C1 pending publication array | move under one publication-work aggregate and preserve pending semantics |
| C1 completion publication disposition | retain unchanged as immutable historical completion evidence; `publicationWork` owns lifecycle |
| C1 positional rebuild helpers | replace with a structured rebuild input/patch that preserves every C2 field |
| C1 semantic state port | add exactly five semantic methods |
| C1 reference reducer/store/conformance | extend as the sole oracle and adapter proof |
| backend rerun flags, task leases, and schedulers | evidence only; do not copy |
| Postgres/Cloudflare clocks and stores | future adapter owners; no C2 import or implementation |

There is no Legacy compatibility path because the package remains private and
has no supported production consumer.

## Canonical Scalar Contracts

C2 adds three private branded scalars:

- `QuerySyncWorkRevision`: bigint in `[0, 2^63 - 1]`, initially zero;
- `PublicationAttemptOrdinal`: safe integer in `[1, 128]`; and
- `PublicationAttemptInstant`: non-negative safe-integer Unix milliseconds.

Capture functions return `Result` with `QuerySyncCanonicalValueError` and the
new exact fields `workRevision`, `publicationAttemptOrdinal`, and
`publicationAttemptInstant`. Work-revision successor returns the typed
terminal `QuerySyncWorkRevisionExhaustedError`; it never wraps. Attempt ordinal
128 has no successor and produces a blocked value decision, not an overflow
error.

The pure publication transitions accept only an already captured instant. An
invalid value read from the trusted Effect Clock is
`QuerySyncInvariantDefect` with invariant `stateClockInstantInvalid`; it is a
defect rather than an expected state-operation failure. The reference adapter
must fold the capture `Result` explicitly into that defect. It may not assert
or silently brand the clock value.

Clock regression is handled by `max(observedNow, storedLastAttemptAt)`. It can
never reduce durable publication age or either retained attempt instant.

## Aggregate Shape And Invariants

The target aggregate is conceptually:

```text
QuerySyncState
  cursor
  queries
    provisional.evaluationDisposition = ready | blocked
  dependencyDirectory
  evaluationWork
    revision
    fairnessAnchor
  publicationWork
    pending
    inFlight
    latestDelivered
    precedingAttemptOutcome
  metrics
```

`evaluationWork.fairnessAnchor` is `null` or one retained canonical query key.
It records the last successful claim. Anchor movement is a separate
continuation fence and does not increment `workRevision` by itself.

Every semantic transaction increments `workRevision` exactly once if it
changes any evaluation eligibility or exact evaluation attempt exposed by
selection, regardless of how many queries or listed facets change:

- creating a provisional;
- raising its coalesced requested-dirty frontier;
- advancing an affected active query's dirty frontier;
- installing a completion and clearing the provisional/dirty work;
- creating a provisional while claiming a dirty active query; and
- first recording terminal evaluator refusal for a provisional.

Unchanged replay/refusal decisions, transient evaluation exhaustion,
publication-only transitions, and fairness-anchor-only movement do not
increment it. Revision `2^63 - 1` is valid retained state. If a semantic
transaction at that value requires one increment, the entire operation fails
before any cursor, query, anchor, publication, or metric change.

An evaluation block is bound to one complete query descriptor and provisional
generation with reason `terminalEvaluatorRefusal` and
`resetRequired: true`. It cannot exist without that exact provisional, cannot
be cleared by begin, claim, invalidation, transient outcome, or completion,
and is removed only by a later separately authorized reset/re-registration
transition.

`publicationWork.inFlight` is `null` or one self-contained immutable
publication plus:

- current attempt ordinal;
- first-attempt and last-attempt instants;
- disposition `ready`, `uncertain`, or `blocked` with an exact block reason.

`ready` means the current ordinal may be attempted and no earlier unresolved
outcome is classified unknown. `uncertain` means the preceding ordinal may
have appended; the current ordinal still carries the same immutable logical
publication. `blocked` permits no further publisher call, but later exact
acceptance evidence may still complete it safely.

The in-flight identity, query identity, completed-through sequence, digest,
and content never change. A completion for that same query may retain exactly
one newer pending publication behind it; another newer completion replaces
only that unclaimed pending record. Other pending work never overtakes a
blocked in-flight publication.

The C1 completion fingerprint and its `unchanged | pending` publication
disposition remain immutable historical completion/replay evidence. Here
`pending` means that completion atomically created publication work; it is not
the later lifecycle authority. Claim, attempt outcome, and delivery never
rewrite that fingerprint or change the receipt returned by an exact
`completeQueryEvaluation` replay. The `publicationWork` aggregate exclusively
owns current pending/in-flight/delivered lifecycle.

While the historical publication is retained pending or in-flight, an exact
completion replay must still compare supplied content with those retained
bytes and reject altered content. After exact delivery removes the bytes, a
completion replay validates the complete C1 fingerprint and digest and can no
longer compare content; it remains mutation-free and can never recreate a
publication.

The latest delivered tombstone retains identity and result digest. The sole
physical owner of preceding attempt outcome is the sibling
`publicationWork.precedingAttemptOutcome` tombstone. It retains the exact
publication identity, digest, ordinal, classification, and projected receipt
required for one replay window; it does not duplicate publication content.
Claim and delivery do not clear it. The next successfully recorded publication
outcome replaces it, after which the older outcome has
`recoveryEvidenceExpired`.

Publication capacity is fail-before-call. Before `claimPublication` may expose
an externally callable attempt, the aggregate must establish a settlement
envelope for that in-flight lifecycle. Aggregate-byte accounting charges the
greater of the currently retained lifecycle footprint and the maximum footprint
reachable by any permitted next settlement, including the one
preceding-outcome fingerprint/receipt, next ordinal and instants, the largest
blocked disposition, and the delivered tombstone. This is a conservative
accounting reservation, not a second stored copy of those values.

The envelope is preserved for the entire in-flight lifetime. A query completion
that creates or replaces newer pending work behind it cannot consume those
bytes. If the envelope cannot be established, claim fails atomically through
the existing aggregate capacity error before moving pending work or returning
an attempt. Once an attempt has been returned, recording
`knownNotAppended`, `outcomeUnknown`, or `terminalRefusal`, entering ordinal,
age, or terminal block, and completing exact accepted delivery cannot fail
solely because the aggregate-byte ceiling lacks settlement space.

The structured aggregate builder validates all cross-links, ordering,
authority, generation, ordinal, time, disposition, uniqueness, and exact byte
metrics. It rejects, at minimum:

- an out-of-range revision or missing anchor query;
- a block without its exact provisional;
- the same publication identity in pending and in-flight state;
- more than one pending publication per query;
- a queued generation not newer than an in-flight generation for that query;
- crossed query identity, digest, content, cursor, or authority;
- invalid attempt ordinal/status/outcome combinations;
- first-attempt time after last-attempt time;
- internally inconsistent preceding-outcome fingerprint or receipt; and
- malformed or crossed pending, in-flight, delivered, or preceding-outcome
  lifecycle evidence.

The historical C1 `pending` completion disposition is not used to infer that
work is still unresolved after its lifecycle record has been claimed,
coalesced, or delivered. This prevents a bounded delivery tombstone from
becoming an unbounded per-query delivery history.

All rebuild helpers use one structured patch and preserve every unmodified
aggregate field. Positional optional C2 state parameters are forbidden because
they can silently erase work authority.

## Evaluation Scan Contract

`EvaluationWorkScanRequest` contains:

- `maximumQueryInspections`, a positive safe integer no greater than 4,096;
  and
- `continuation`, either `null` or a state-issued frozen continuation.

`EvaluationWorkScanContinuation` is a nominal, state-issued, process-local
capability. Its frozen observable fields contain exactly:

- namespace, sync-model, and source-epoch identity;
- observed `workRevision`;
- scan-start fairness anchor;
- last inspected canonical query key, or `null` before inspection;
- whether canonical wrap occurred; and
- the lowest canonical blocked-work evidence observed so far, or `null`.

The continuation is progress evidence, not durable work authority. Its private
runtime authenticity prevents a caller from forging prior inspections or a
blocked accumulator and thereby manufacturing `none`. The transaction still
revalidates every observable field. Cross-authority input is a typed authority
error. A fabricated, decoded, or malformed value is a typed
invalid-continuation error. A coordinator that restarts without the original
capability passes `null` and begins after the durable fairness anchor; no
continuation codec or persistence obligation exists in C2. A revision or
fairness-anchor mismatch returns `scanRestarted` with a fresh continuation
beginning after the current durable anchor; it is not a failure and cannot
return idle.

`claimEvaluationWork(state, request)` returns exactly:

- `claimed`: one state-issued `QueryEvaluationAttempt` and the next fresh scan
  continuation after the newly durable fairness anchor;
- `continued`: the budget ended before a claim or stable full wrap;
- `scanRestarted`: eligibility or anchor changed since scan start;
- `blocked`: one stable full wrap found no runnable work and returns the lowest
  canonical blocked query/generation plus reset-required evidence; or
- `none`: one stable full wrap found neither runnable nor blocked work.

Runnable work is a non-blocked existing provisional or a dirty active query.
The latter atomically creates/replays its successor provisional through the C1
expected-active fence. A successful claim advances the fairness anchor to that
query. Existing provisional work is not made exclusive and remains
rediscoverable.

Blocked evidence accumulated in a continuation is revalidated under the same
revision and anchor before `blocked` is returned. Runnable work always wins
over blocked visibility. `none` and `blocked` are authoritative only for one
stable complete wrap.

The exact cyclic scan order is frozen. With a `null` anchor, inspect retained
queries once in ascending canonical-key order. With a non-null anchor, inspect
keys greater than the anchor in ascending order, then wrap to the least key and
finish with the anchor itself. Every query present at the stable revision is
therefore inspected exactly once. If the final permitted inspection also
finishes the cycle, return `none` or `blocked` in that call rather than
`continued`. An empty aggregate returns `none` without an inspection.

## Evaluation Attempt Outcome Contract

`EvaluationAttemptOutcome` is exactly `transientExhausted` or
`terminalRefusal`.

`QueryEvaluationAttempt` is a frozen nominal, process-local capability with
one issuance owner shared by `beginQueryEvaluation`, `claimEvaluationWork`,
and their state receipt projections. Structural copies and decoded values are
rejected as `notStateIssued`. The exact oracle-fixture mint is named
`makeQueryEvaluationAttemptForTesting` and is exported only from
`./testing/conformance`; production kernel and state exports expose only the
opaque attempt type and the semantic operations that issue it.

`recordEvaluationAttemptOutcome(state, attempt, outcome)` returns exactly:

- `eligible`: transient exhaustion left the exact provisional runnable;
- `blocked`: terminal refusal was recorded, or the exact provisional was
  already blocked, with identical reset-required evidence;
- `superseded`: the generation is inside the retained newer-completion window;
  or
- `recoveryEvidenceExpired`: the generation is older than that window.

For the live provisional, the operation revalidates full authority,
descriptor, generation, expected-active fence, registration cursor, and
requested dirty frontier. If that exact provisional is already blocked,
`transientExhausted` also returns the existing `blocked` receipt and never
reopens it.

For the just-completed current generation, the retained full completion
fingerprint revalidates the attempt and returns `superseded`. For the
immediately preceding completion identity, authority, descriptor identity, and
generation are revalidated but the no-longer-retained fence/cursor/dirty fields
are not falsely reconstructed; it also returns `superseded`. Anything older
returns `recoveryEvidenceExpired`. Terminal refusal increments the revision
once. Exact block replay returns the same `blocked` receipt and never
increments twice. A stale outcome can never block a completed or newer
generation.

`beginQueryEvaluation` and `completeQueryEvaluation` fail with typed
`QueryEvaluationWorkBlockedError` when their exact provisional is durably
blocked. They never bypass or silently clear it.

## Publication Claim Contract

`claimPublication(state, now)` receives a captured trusted instant only in the
pure kernel. The semantic state method has no time parameter.

It returns exactly:

- `claimed`: the lowest canonical pending identity moved atomically to
  in-flight at ordinal 1;
- `replayed`: the current ready/uncertain in-flight attempt, byte-for-byte
  identical in publication, ordinal, and retained instants;
- `blocked`: the in-flight record is already blocked or reached the inclusive
  age limit before another call; or
- `none`: no in-flight or pending publication exists.

`PublicationAttempt` contains the exact immutable publication, current
ordinal, first-attempt instant, and current attempt instant. `lastAttemptAt` is
the instant at which the current ordinal was issued. Initial claim sets both
instants. A non-blocking recorded outcome issues the next ordinal and sets its
attempt instant to the clamped current time. Replay never refreshes either
instant. Claiming a pending publication removes it from the pending set in the
same transition. Two competing claims can create only one namespace-wide
in-flight record.

The inclusive age decision is `clampedNow - firstAttemptAt >= 604_800_000`.
Age blocking updates disposition only; it does not rewrite either attempt
instant because no new external attempt was issued. Later blocked claims are
unchanged replays. It never evicts or overtakes the record.

## Publication Attempt Outcome Contract

`PublicationAttemptOutcome` is exactly `knownNotAppended`, `outcomeUnknown`,
or `terminalRefusal`.

`recordPublicationAttemptOutcome(state, attempt, outcome, now)` receives the
trusted instant only in the pure kernel and returns exactly:

- `recorded`: the exact ordinal/outcome was recorded and a next ordinal is
  exposed;
- `blocked`: ordinal 128, inclusive seven-day age, or terminal refusal entered
  fail-closed reset-required state;
- `superseded`: exact delivery already resolved the retained publication; or
- `recoveryEvidenceExpired`: the request is older than the one retained
  outcome replay window.

Lookup order is exact. First compare the request and outcome with the retained
`precedingAttemptOutcome` fingerprint; an exact match returns its stored
receipt even if delivery later completed or another publication was claimed.
A different outcome for that same retained attempt fingerprint is
`InvalidPublicationAttemptOutcomeReplayError` and changes nothing. Only when
that replay check does not match does the operation classify the current
in-flight, delivered/superseded, or expired state.

For a current attempt, the request must match the state-issued publication,
content, digest, ordinal, first-attempt instant, and attempt instant. Another
outcome for a delivered identity is `superseded` when no exact preceding
outcome receipt matches. Once a later recorded outcome replaces the single
tombstone, an older outcome request is `recoveryEvidenceExpired`.

Exact replay of the immediately preceding ordinal/outcome returns the stored
`recorded` or `blocked` receipt and never advances twice. For a non-blocking
known-not-appended outcome, the next disposition is `ready`; for a
non-blocking unknown outcome, it is `uncertain`. Both advance by one ordinal
while retaining the same publication. The receipt exposes the next ordinal,
not a transient content copy; `claimPublication` returns the next exact
attempt.

Recording ordinal 128 blocks even if the clock is frozen. No ordinal 129 is
constructed. Terminal refusal blocks immediately. A current attempt outcome
received after age blocking returns the existing `blocked` receipt and cannot
reopen or advance work. Blocking decisions retain the current attempt instant;
only issuing a next ordinal updates `lastAttemptAt`. Clock regression is
clamped before age and retained-time decisions.

## Publication Acceptance Contract

`AcceptedQueryPublicationEvidence` is a runtime-authenticated nominal value
bound to exact publication identity and result digest. The implementation uses
a module-private `AdmittedQueryPublicationEvidence` class (or an equivalent
private runtime token), rejects structural literals and decoded values, and
exports only the opaque type through the private kernel/state boundary. The
exact testing mint is named
`makeAcceptedQueryPublicationEvidenceForTesting` and is exported only from
`./testing/conformance`. No production code may mint it before C4 defines
`ResultPublisher` and an accepted delivery adapter translates its exact
acceptance/read-back proof.

`completePublication(state, evidence)` returns exactly:

- `completed`: exact matching in-flight work was removed and the delivered
  tombstone installed;
- `replayed`: the evidence matches the latest delivered tombstone; or
- `superseded`: it matches neither the current in-flight publication nor the
  retained delivery tombstone.

Cross namespace/model/epoch evidence is a typed authority error. The same
identity with another digest is invalid acceptance evidence. Exact evidence
may complete `ready`, `uncertain`, or `blocked` in-flight work because exact
acceptance resolves uncertainty more strongly than the no-more-attempts block.
It never completes a different publication. A queued newer publication remains
pending and becomes claimable only after the in-flight record is resolved.

## Exact Pure And Effect Channels

The new pure error unions are frozen as:

| Pure operation | Error union |
| --- | --- |
| `claimEvaluationWork` | `InvalidEvaluationWorkScanRequestError \| QuerySyncAuthorityError<"claimEvaluationWork"> \| InvalidEvaluationWorkContinuationError \| QueryGenerationExhaustedError<"claimEvaluationWork"> \| QuerySyncWorkRevisionExhaustedError<"claimEvaluationWork"> \| BuildQuerySyncStateError` |
| `recordEvaluationAttemptOutcome` | `QuerySyncAuthorityError<"recordEvaluationAttemptOutcome"> \| QueryKeyCollisionError<"recordEvaluationAttemptOutcome"> \| QueryStateNotFoundError<"recordEvaluationAttemptOutcome"> \| QueryGenerationMismatchError<"recordEvaluationAttemptOutcome"> \| InvalidEvaluationAttemptError \| QuerySyncWorkRevisionExhaustedError<"recordEvaluationAttemptOutcome"> \| BuildQuerySyncStateError` |
| `claimPublication` | `BuildQuerySyncStateError` |
| `recordPublicationAttemptOutcome` | `QuerySyncAuthorityError<"recordPublicationAttemptOutcome"> \| InvalidPublicationAttemptError \| InvalidPublicationAttemptOutcomeReplayError \| BuildQuerySyncStateError` |
| `completePublication` | `QuerySyncAuthorityError<"completePublication"> \| InvalidAcceptedPublicationEvidenceError \| BuildQuerySyncStateError` |

The existing `QueryGenerationExhaustedError`, `QueryStateNotFoundError`, and
`QueryGenerationMismatchError` classes are generalized only by an
operation-type parameter covering their new C2 operation owners. Their tags,
semantic fields, and existing C1 variants do not change.

The existing pure channels change only as required by revision/block state:

- `BeginQueryEvaluationError` adds
  `QuerySyncWorkRevisionExhaustedError<"beginQueryEvaluation">` and
  `QueryEvaluationWorkBlockedError<"beginQueryEvaluation">`;
- `ApplyInvalidationsError` adds
  `QuerySyncWorkRevisionExhaustedError<"applyAdmittedInvalidations">`; and
- `CompleteQueryEvaluationError` adds
  `QuerySyncWorkRevisionExhaustedError<"completeQueryEvaluation">` and
  `QueryEvaluationWorkBlockedError<"completeQueryEvaluation">`.

Every state method captures its adapter dependencies and has requirement
channel `never`:

| State method | Success receipt tags | Expected error channel |
| --- | --- | --- |
| `claimEvaluationWork` | `claimed`, `continued`, `scanRestarted`, `blocked`, `none` | `ClaimEvaluationWorkError \| QuerySyncStateIntegrationError<"claimEvaluationWork">` |
| `recordEvaluationAttemptOutcome` | `eligible`, `blocked`, `superseded`, `recoveryEvidenceExpired` | `RecordEvaluationAttemptOutcomeError \| QuerySyncStateIntegrationError<"recordEvaluationAttemptOutcome">` |
| `claimPublication` | `claimed`, `replayed`, `blocked`, `none` | `ClaimPublicationError \| QuerySyncStateIntegrationError<"claimPublication">` |
| `recordPublicationAttemptOutcome` | `recorded`, `blocked`, `superseded`, `recoveryEvidenceExpired` | `RecordPublicationAttemptOutcomeError \| QuerySyncStateIntegrationError<"recordPublicationAttemptOutcome">` |
| `completePublication` | `completed`, `replayed`, `superseded` | `CompletePublicationError \| QuerySyncStateIntegrationError<"completePublication">` |

All receipts are owned frozen projections. No receipt, continuation, attempt,
or nominal evidence exposes mutable aggregate collections or becomes durable
authority outside its exact state revalidation.

## Transaction, Retry, And Uncertainty Rules

Each state method is one semantic atomic transaction. It exposes no aggregate
read, raw CAS, driver CRUD, transaction callback, arbitrary save, or
cursor-only write.

- A `notCommitted` integration failure may retry the exact operation.
- An unknown evaluation-claim response is recovered by asking state for
  current durable work; duplicate evaluation is allowed.
- An unknown terminal-outcome response replays the exact attempt/outcome while
  its current block/retained completion window exists and cannot increment
  revision twice.
- An unknown publication-claim response replays the identical in-flight
  attempt.
- An unknown publication-outcome response replays the exact ordinal/outcome
  while the one-outcome tombstone remains and cannot advance twice; after that
  window it returns `recoveryEvidenceExpired`.
- An unknown publication-completion response replays exact acceptance evidence
  while the latest-delivered tombstone remains; after that window it returns
  `superseded`.

Unknown is never renamed rollback. C2 adds no `Effect.retry`, sleep, timeout,
deadline, Fiber, loop, evaluator, or publisher. Those policies belong to C3/C4.

## Bounds And Exact Thresholds

| Dimension | C2 hard maximum |
| --- | ---: |
| query inspections per evaluation scan call | 4,096 |
| work revision | `2^63 - 1` |
| pending publications per namespace, excluding in-flight | 4,096 |
| namespace-wide in-flight publications | 1 |
| newer pending publication behind an in-flight publication for one query | 1 |
| retained pending plus in-flight content | 32 MiB |
| inline publication content | 1 MiB decoded bytes |
| durable publication attempts | 128 |
| durable publication age | 604,800,000 ms, inclusive |
| aggregate counted canonical bytes | 64 MiB |

Metrics distinguish pending count, in-flight count, and retained publication
content bytes. Work revision/anchor, evaluation disposition, in-flight
metadata, outcome receipt, delivered tombstone, settlement envelope, and all
presence/tag/fixed integer bytes are included in exact aggregate accounting.
The envelope charges only the additional headroom above the currently retained
lifecycle footprint, so current bytes are not counted twice. Capacity maxima
are admissible and the first value above them fails atomically. The attempt and
age limits are inclusive stop thresholds: ordinal 128 or age exactly seven
days returns `blocked`. Maximum work revision is valid retained state, but any
semantic transaction requiring its successor fails atomically.

## Reference And Test Plan

The two new focused files prove:

### `evaluationWorkSelection.test.ts`

- empty stable wrap, provisional recovery, and dirty-active successor creation;
- canonical round-robin order independent of insertion history;
- small-budget continuation, wrap, stable `none`, and stable `blocked`;
- revision and anchor restart without skipped work or lowest-key starvation;
- invalidation before/behind a continuation and during evaluation;
- transient eligibility, terminal block, exact replay, stale outcome, and
  revision exhaustion, including begin- and claim-issued attempts plus
  rejection of structural attempt forgeries;
- state-identity proofs that a blocked begin, including a higher requested
  frontier, fails without coalescing and a blocked completion cannot install or
  publish;
- invalidation may advance durable dirty state but retains the exact block,
  `transientExhausted` returns that block, and claim skips it while runnable
  work exists before reporting it only after one stable full wrap;
- scan budgets `0`, `1`, `4,096`, `4,097`, fractional, non-finite, and unsafe;
- independent revision/anchor mismatch, crossed authority, invalid
  last-key/wrap combinations, and fabricated blocked accumulation; and
- absence of owner token, lease expiry, renewal, reclaim, or process-local
  scheduling authority.

### `publicationAttemptState.test.ts`

- canonical first claim, serialized competing claims, and exact claim replay;
- known-not-appended and unknown outcome ordinal advancement;
- response-loss replay without double increment;
- outcome-commit response loss followed by exact delivery and then exact
  outcome replay;
- terminal, attempt 128, `7d - 1ms`, exact seven-day, post-age outcome replay,
  and clock-regression decisions;
- in-flight immutability plus exactly one replaceable newer pending result;
- exact completion, completion replay, stale/crossed evidence, and completion
  of a blocked publication with exact acceptance;
- exact `completeQueryEvaluation` replay in pending, in-flight, and delivered
  states; altered valid content is rejected by retained-byte comparison while
  pending or in flight, whereas delivered replay uses only the retained
  complete fingerprint/digest, changes nothing, and never recreates work;
- rejection of structural or decoded forgeries of nominal acceptance evidence;
- latest delivered and preceding-outcome replay windows; and
- count/content/aggregate byte boundaries, including claim refusal before an
  attempt when its full settlement envelope does not fit, exact-boundary
  claim-to-each-outcome and claim-to-delivery histories, preservation of the
  envelope against a queued newer completion, and capacity-infallible ordinal
  128, age, and terminal blocking after an attempt is issued.

Connected existing tests add:

- one mixed C1/C2 pure-reference-state conformance history;
- deterministic TestClock histories for state-owned time;
- before/after-commit faults on mutating paths for all five operations;
- competing-turn serializability, with at least two evaluation claims over
  multiple runnable queries, evaluation claim versus invalidation/revision
  change, terminal evaluation outcome versus `completeQueryEvaluation` for the
  same provisional, two publication claims, publication claim versus a newer
  query completion, publication outcome versus exact publication completion in
  both serialization orders, and delivery of an older in-flight publication
  versus creation or replacement of its queued newer publication; every result
  must equal one complete pure serial history;
- receipt/attempt/continuation ownership and runtime freezing;
- namespace/model/epoch/query/generation/ordinal isolation;
- forged aggregate invariant rejection; and
- deterministic seeded histories across both synthetic model shapes.

Scalar proofs cover revision `-1n`/zero/maximum/above-maximum and wrong
primitive types; ordinal `0`/`1`/`128`/`129`, fractional, non-finite, unsafe,
and wrong primitive types; and instant negative/zero/maximum-safe/
above-maximum-safe, fractional, non-finite, and wrong primitive types. Every
invalid case proves its exact field-specific `QuerySyncCanonicalValueError`.
Revision cardinality proofs show exactly one increment for begin creation and
frontier coalescing, invalidation affecting one or many queries, completion
clearing several work facets, dirty-active claim, and first terminal block.
Invalidation affecting zero queries and every unchanged replay path increment
zero times. Every incrementing operation is also proved at maximum revision
with complete atomic refusal.

Time-sensitive conformance runs as one `Effect.gen` history under one
`TestClock.layer()`. Before each publication command, the conformance runner
captures the stable Effect instant once for its pure reducer; the reference
state method reads the same non-advanced TestClock. Tests change time only with
`TestClock.setTime` or `TestClock.adjust` between commands. Live-clock
timestamp equality is not a C2 conformance mode. The implementation audit
rejects `Date.now`, `DateTime.nowUnsafe`, and a parallel manual clock port in
the C2 reference flow. Invalid injected clock output is asserted through an
`Exit`/defect proof for `stateClockInstantInvalid`.

The existing swap fault injector is used only with a mutating decision. It is
not left armed by attempting to fault an unchanged `none`, continuation, or
replay response. After-commit recovery proves the exact operation contract:

- evaluation claim asks for current durable work and may fairly select another
  query; exact claim replay is not promised;
- terminal evaluation outcome returns one durable block with one revision
  increment;
- publication claim returns the identical attempt;
- publication outcome returns the retained identical receipt without another
  ordinal/count advance; and
- publication completion resolves through the delivered tombstone.

## Validation Gate

The implementation must pass:

- `pnpm --filter @flarex/query-sync typecheck`;
- the full `@flarex/query-sync` test suite;
- `pnpm check:effect-boundaries`;
- forbidden-import, package-export, dependency, runtime, aggregate-read, and
  lease-token audits;
- ownership inspection proving only durable aggregate state selects work;
- uncertainty inspection proving no broad retry or unknown-as-rollback path;
- `pnpm lint:core` and `pnpm lint:diff`;
- `git diff --check`;
- both standing reviewers against the final significant diff; and
- `pnpm lint:diff -- --staged` against the exact intended index before commit.

Reference tests do not prove a real database, Cloudflare transaction,
publisher, or runtime portability. Those claims remain later gates.

## Explicitly Not Authorized

C2 does not authorize:

- C3/C4 orchestration, an evaluator, publisher, background process, or runtime;
- an evaluation or publication lease, owner token, renewal, expiry, steal, or
  automatic reclaim;
- release, destructive reset, re-registration, or eviction of blocked work;
- a real SQLite/Postgres/PGlite/filesystem/network/stream adapter or schema;
- a Worker, Durable Object, alarm, queue, route, authentication, client,
  WebSocket, SSE, reconnect, resume, or SDK path;
- a Context service or Layer for namespace/query/request/object state;
- Electric, Durable Streams, or another new dependency/adoption decision;
- Flarex query execution, model/change/result mapping, relation/Payload work,
  or `R03-B`;
- OCC, commit compilation/execution, journals, application rows, commit feed,
  or existing application outbox changes;
- aggregate read/save, generic transaction callback, raw CAS, or driver escape
  hatch; or
- Legacy dual state, dual writes, fallback, comparison, migration, cutover, or
  a portability/production-readiness claim.

## Exit And Next Gate

C2 exited after the pure oracle and reference semantic state proved bounded
fair evaluation selection, revision/anchor recovery, terminal block replay,
one immutable in-flight publication, exact attempt count/age decisions,
queued-newer preservation, and exact acceptance completion under uncertainty.

The implementation receipt is:

- `pnpm --filter @flarex/query-sync typecheck`;
- `pnpm --filter @flarex/query-sync test` -- 17 files and 168 tests;
- `pnpm lint:core` and `pnpm lint:diff`;
- `pnpm check:effect-boundaries`;
- `git diff --check -- packages/query-sync`;
- both standing final-diff reviews -- no findings.

C2 completion does not complete QSYNC01-C. C3 remains separately gated for one
bounded evaluation orchestration turn. C4 remains separately gated for the
publication coordinator and full reference recovery matrix. Real adapters
remain blocked until all of C completes and their own preflights are approved.
