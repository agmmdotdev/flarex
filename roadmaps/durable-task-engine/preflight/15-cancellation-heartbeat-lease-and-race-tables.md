# DTE03-D: Cancellation, Heartbeat, Lease, Completion, And Race Tables

## Receipt Status

**Status:** Complete — admit the DTE03-D operation transition tables, logical
lease-expiry rule, cancellation lifecycle, replay precedence, and cross-command
race winners.

**Decision:** Every mutation is decided from one decoded aggregate and one
transaction database-time snapshot. A current fence is usable only while its
lease is logically unexpired. Ordinary stale work returns current state,
exact direct replay is idempotent, conflicting completion is a typed conflict,
and invalid cancellation acknowledgement is a typed command/transition error.

This receipt fixes transition semantics for the five DTE02 mutation operations
over DTE03-B's five phases and DTE03-C's policy. DTE03-E now encodes the exact
closed outcome, inspection, acceptance, evidence, requested-effect, and error
records in
[`16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md)
without changing their meaning.
DTE03-F's canonical race/replay vectors and executable contract gate are
complete in
[`17-compatibility-vectors-and-executable-gate.md`](./17-compatibility-vectors-and-executable-gate.md).

No package, database schema, migration, adapter, queue, scheduler, compute host,
route, public API, or production activation is authorized.

## Fixed Inputs

DTE03-D assumes without reopening:

- phases `ready`, `attempt_granted`, `executing`, `retry_waiting`, and
  `terminal`;
- orthogonal not-requested/requested/resolved cancellation state;
- one current attempt ID, number, fence, compute profile, stored jitter, and
  lease in active phases;
- heartbeat-proven execution beginning with the first accepted sequence;
- inclusive total-attempt policy `1..250`;
- deterministic retry/OOM/terminal policy from DTE03-C;
- one latest ordinary-mutation acceptance plus bounded completion replay;
- exactly `accepted`, `idempotent`, and `current` service-receipt dispositions;
  and
- the six DTE02 service commands and two-operation store port.

## Lease-Version Cursor Correction

DTE02 requires `TaskLeaseVersionV1` to advance for every accepted lease grant
or renewal. DTE03-B fixed the current lease but did not retain the last issued
lease version after an attempt stopped. The aggregate therefore gains this
common cursor:

```ts
type TaskLeaseHistoryCursorV1 =
  | { readonly kind: "none" }
  | {
      readonly kind: "issued";
      readonly lastLeaseVersion: TaskLeaseVersionV1;
    };
```

`TaskRunAttemptAggregateBaseV1` contains:

```ts
readonly leaseHistory: TaskLeaseHistoryCursorV1;
```

Rules:

- a new run begins with `none`;
- accepted `startAttempt` issues `1` or increments the last issued version;
- every accepted heartbeat increments it again;
- clearing current-attempt state never resets it;
- the active `currentAttempt.lease.version` equals the cursor's last value;
- no non-lease mutation changes it; and
- exhaustion is the already-admitted counter/terminal-store error with no
  write, never wraparound or task failure.

This is state required to implement DTE02's already-admitted lease identity,
not a new command, port, or authority.

## Logical Lease Rule

For the current active attempt, define:

```text
leaseIsLive = databaseNowMs < currentAttempt.lease.expiresAtMs
leaseIsExpired = databaseNowMs >= currentAttempt.lease.expiresAtMs
```

The boundary is exact: equality is expired.

A fence plus an expired lease no longer authorizes heartbeat or completion,
even if the durable expiry wake has not been delivered. The wake applies the
recovery transition; it does not cause logical expiry.

Consequences:

- heartbeat never resurrects an expired lease;
- exact replay of an already-accepted heartbeat or completion may still return
  its stored idempotent receipt after expiry, but performs no renewal or state
  mutation;
- a late worker completion cannot beat an already-reached database deadline by
  arriving before the wake handler;
- a completion accepted with transaction time strictly before expiry wins and
  makes the later wake current/stale;
- lease expiry uses database time, not effect delivery time; and
- host, queue, alarm, or Worker clock skew cannot extend authority.

## Decision Precedence Shared By All Mutations

Every mutation applies this order before its operation-specific table:

1. decode the closed command before service execution;
2. validate fresh scope authority and load/decode the aggregate in the store;
3. for completion, search the bounded attempt/fence replay index before a
   generic phase/current-attempt result;
4. for other operations, compare the command with
   `lastLifecycleAcceptance` for exact direct replay;
5. validate operation-relevant run version, attempt, fence, lease version, or
   cancellation generation against current state;
6. evaluate logical lease time where the operation requires live execution;
7. apply the operation transition table and DTE03-C policy;
8. on commit, advance run version exactly once and lease version only when the
   table says so;
9. atomically store next aggregate, acceptance/replay, evidence, and ordered
   requested effects; and
10. return detached persisted receipt data.

Replay comparison never bypasses aggregate corruption checks. A malformed
replay record is corruption, not permission to return idempotent success.

## Disposition Vocabulary

### Accepted

`accepted` means this command commits a new lifecycle mutation. It advances
`runVersion`, replaces `lastLifecycleAcceptance`, and may persist evidence and
requested effects. Lease grant/renewal additionally advances `leaseHistory`.

### Idempotent

`idempotent` means the exact canonical command identity matches a stored
acceptance and its exact original receipt can be reconstructed:

- start/heartbeat/cancellation/expiry use the latest ordinary-mutation
  acceptance only; and
- completion uses its longer per-attempt replay history.

Idempotent delivery writes nothing, allocates nothing, changes no time or
lease, and returns the original observed time, run version, evidence, effects,
and outcome.

### Current

`current` means the command no longer applies and no exact accepted receipt is
available. It returns safe current authoritative state, uses the current
transaction observation time, emits no new evidence/effects, and never claims
the old command succeeded.

Ordinary stale run version, attempt, fence, heartbeat sequence, lease version,
phase, early timing, and already-terminal delivery use `current`, not an
exception.

### Typed Rejection

Only semantic misuse requiring caller correction is rejected through the typed
error channel in these tables:

- different completion for an already-recorded attempt/fence composite;
- cancellation acknowledgement with no current request or the wrong current
  generation; and
- decoded-but-impossible policy/counter/state data attributable to corruption
  or an internal invariant.

DTE03-E fixes the exact tagged error types and safe details.

## `startAttempt` Transition Table

Command identity is `(runId, expectedRunVersion)`. `retryJitter` becomes part
of the accepted grant but cannot change an existing grant on redelivery.

| Current state | Additional condition | Result |
| --- | --- | --- |
| `ready` | expected version matches, database time is at/after `eligibleAtMs`, next attempt exists | **accepted**: use candidate, enter `attempt_granted`, issue next lease version and expiry, store jitter, request dispatch and lease-expiry wake |
| `retry_waiting` | expected version matches, database time is at/after `notBeforeMs`, next attempt exists | **accepted**: same grant transition using retry-selected compute profile |
| any phase | latest acceptance is the exact start basis and its grant remains the current direct result | **idempotent**: return original grant receipt; ignore redelivered jitter |
| `ready` | matching version but before `eligibleAtMs` | **current**: too early, no candidate use or effect |
| `retry_waiting` | matching version but before `notBeforeMs` | **current**: too early |
| any phase | expected version does not equal current and exact direct replay does not match | **current** |
| active or terminal | not exact direct replay | **current** |

Accepted grant invariants:

1. candidate attempt number is exactly cursor-plus-one;
2. candidate ID/fence are used only after every state/policy check;
3. current attempt `grantBasisRunVersion` equals the command's expected version;
4. next run version advances once;
5. lease version advances once and expiry equals database time plus bound lease
   duration with checked arithmetic;
6. heartbeat state is `none_accepted`;
7. cancellation remains `not_requested`;
8. ready/retry state is removed; and
9. requested effects do not embed a queue, provider target, or scope.

A valid startable aggregate always has another attempt under DTE03-C. Finding
one at its limit is corruption/invalid stored transition. It is not accepted
terminalization and the allocation candidate remains unused.

## `heartbeatAttempt` Transition Table

Command identity is `(runId, attemptId, executionFence, heartbeatSequence)`.

| Current state | Condition | Result |
| --- | --- | --- |
| `attempt_granted` | attempt/fence match and lease is live | **accepted**: enter `executing`, store sequence as highest, renew from database time, advance lease/run versions, request replacement expiry wake |
| `executing` | attempt/fence match, lease live, sequence greater than highest | **accepted**: retain phase, store new highest, renew lease, advance lease/run versions, request replacement expiry wake |
| active, with or without cancellation request | exact latest heartbeat acceptance matches command | **idempotent**: original receipt, no second renewal |
| `executing` | attempt/fence match and sequence equals highest but latest acceptance is another operation | **current**: already represented, exact receipt no longer latest |
| `executing` | attempt/fence match and sequence lower than highest | **current** |
| active | attempt or fence differs | **current** |
| active | lease is expired | **current**: never renew; expiry recovery remains due |
| `ready`, `retry_waiting`, or `terminal` | any | **current** |

A sequence gap is accepted; a missing earlier delivery does not prevent a later
live worker from renewing. A heartbeat while cancellation is requested follows
the same table and retains the request. This preserves time for a live worker
to acknowledge cancellation; it does not withdraw or supersede the request.

Each accepted renewal requests cancellation/obsolescence of the prior expiry
wake followed by one wake for the new lease version. DTE03-E fixes the exact
effect order and retains that cancellation effect for both first and later
accepted heartbeats.

## Completion Replay And Conflict Table

Before examining current phase, lookup the command's attempt/fence pair in
`completionReplays`:

| Replay lookup | Result |
| --- | --- |
| pair exists and canonical completion is identical | **idempotent** with exact original completion receipt, regardless of current phase or later attempts |
| pair exists and canonical completion differs | typed `ConflictingTaskAttemptCompletion` rejection, no write |
| pair absent | continue to current-attempt table |

Canonical equality compares these identity-bearing completion members:

- success kind, result presence, codec, byte length, digest bytes, and execution
  duration;
- failed kind, failure kind/code, directive and override delay, and
  duration; or
- cancellation-acknowledged kind, generation, and duration.

Object identity, field insertion order, mutable byte-array aliasing, and a
caller stack are never equality inputs. The bounded failure message is also not
an equality input under DTE03-C's diagnostic-only rule. A redelivery differing
only in that message is idempotent and returns the originally stored completion,
message, and receipt; it does not rewrite diagnostic history.

## Current `completeAttempt` Transition Table

When no completion replay exists, evaluation first requires an active phase and
the exact current attempt/fence. A mismatch returns `current`. For that matching
pair, a cancellation acknowledgement validates request presence and generation
before logical lease time; success/failure proceeds directly to the lease-time
check. This fixes which overlapping row below applies; DTE03-E names the exact
typed error records.

| Current state | Condition | Result |
| --- | --- | --- |
| `attempt_granted` or `executing` | attempt/fence match and lease live, success | **accepted** terminal success; clear current authority; append replay |
| active | attempt/fence match and lease live, failed completion | **accepted** DTE03-C retry or terminal failure; clear current authority; append replay |
| active with cancellation requested | live success | **accepted** terminal success; cancellation resolves `superseded_by_completion` |
| active with cancellation requested | live failed completion | **accepted** terminal failure only; retry is suppressed and cancellation resolves `superseded_by_completion` |
| active with matching cancellation request | live acknowledgement with exact generation | **accepted** terminal cancellation resolution `acknowledged`; append replay |
| active | acknowledgement but no request | typed invalid-cancellation-acknowledgement rejection |
| active with request | acknowledgement generation differs | typed invalid-cancellation-acknowledgement rejection |
| active | attempt or fence differs | **current** |
| active | logical lease expired | **current**: completion cannot resurrect authority |
| `ready`, `retry_waiting`, or `terminal` | pair has no replay | **current** |

### Cancellation Versus Failure Policy

Once cancellation is requested, no completion may create another retry. A
successful or failed completion may still win while the lease is live because
the request is best-effort until acknowledged or expiry. Success keeps success;
failure keeps its original terminal class/failure. Both record
`superseded_by_completion` so accepted cancellation history is not erased.

This is a deliberate improvement over letting a non-cancellation failure from a
pending-cancel execution schedule more work. It also avoids reporting terminal
cancellation when the worker actually committed a completed result first.

Every accepted completion requests obsolescence of the current lease wake.
Terminal success/failure/cancellation and retry effects follow the exact order
fixed by DTE03-E.

## `requestCancellation` Transition Table

Command identity for direct replay is `(runId, canonical reason)`. There is no
administrative request ID, so a different later reason cannot create another
generation in V1.

| Current state | Condition | Result |
| --- | --- | --- |
| `ready` or `retry_waiting` | cancellation not requested | **accepted** terminal cancellation, generation 1, resolution `without_active_attempt`; advancing run version makes any earlier retry wake stale |
| `attempt_granted` or `executing` | cancellation not requested | **accepted** same phase/current lease, generation 1 requested, request execution cancellation effect |
| active or terminal | latest acceptance is exact same cancellation command | **idempotent** original receipt |
| active with request | same or different reason but exact replay no longer latest | **current** existing first reason/generation; no rewrite or new effect |
| terminal | not exact direct replay | **current** terminal outcome |

The first accepted reason wins. A different reason is not a conflict because
the command has no identity proving a distinct authorized request; it simply
observes the existing request/current terminal outcome. Future independently
addressable administrative cancellation requests require a separate command-
identity preflight.

The V1 model has no withdrawal/resume transition, so the first accepted request
issues generation 1 and every resolution is terminal. The broader bounded
generation type remains compatible with later versioned capabilities, but V1
does not manufacture higher generations.

Cancellation request does not revoke or renew the current lease. Its existing
expiry wake remains necessary so a worker that never acknowledges can be
terminalized safely.

## `handleLeaseExpiry` Version And Timing Table

Command identity is
`(runId, attemptId, executionFence, expectedLeaseVersion)`.

| Current state | Condition | Result |
| --- | --- | --- |
| any | latest acceptance is exact expiry command | **idempotent** original receipt |
| active | attempt or fence differs | **current** |
| active | expected lease version differs from current | **current** |
| active, matching lease | database time is before expiry | **current** early wake; no mutation or replacement effect |
| `attempt_granted`, no cancellation | matching lease is expired | **accepted** synthesize `attempt_dispatch_failed`, apply forced-durable DTE03-C retry/terminal policy |
| `executing`, no cancellation | matching lease is expired | **accepted** synthesize `execution_lost`, apply forced-durable DTE03-C retry/terminal policy |
| either active phase with cancellation request | matching lease is expired | **accepted** terminal cancellation resolution `lease_expired` |
| `ready`, `retry_waiting`, or `terminal` | any | **current** |

Early delivery does not create a replacement wake in V1. The original
persisted effect/delivery owner must honor its not-before time or retry the same
effect, and Roadmaps 04/05 must discover expired active leases independently.
This avoids advancing run version or creating unbounded wake intents merely
because infrastructure delivered early.

Lease-expiry failure is not a completion replay because no runtime completion
was accepted. The accepted expiry receipt remains available only as the latest
ordinary lifecycle acceptance. A later completion for the expired attempt has
no replay and returns current.

## Phase Transition Matrix

| From | Command | Accepted destination |
| --- | --- | --- |
| `ready` | start due | `attempt_granted` |
| `ready` | cancellation | `terminal/cancelled` |
| `attempt_granted` | first heartbeat | `executing` |
| `attempt_granted` | success | `terminal/succeeded` |
| `attempt_granted` | failure, retry immediate | `ready/immediate_retry` |
| `attempt_granted` | failure, retry durable | `retry_waiting` |
| `attempt_granted` | terminal failure | `terminal/failed` |
| `attempt_granted` | cancellation request | `attempt_granted` plus requested cancellation |
| `attempt_granted` | cancellation acknowledgement/expired requested lease | `terminal/cancelled` |
| `attempt_granted` | expired lease without cancellation | `retry_waiting` or `terminal/failed` |
| `executing` | greater heartbeat | `executing` |
| `executing` | success | `terminal/succeeded` |
| `executing` | failure, retry immediate | `ready/immediate_retry` |
| `executing` | failure, retry durable | `retry_waiting` |
| `executing` | terminal failure | `terminal/failed` |
| `executing` | cancellation request | `executing` plus requested cancellation |
| `executing` | cancellation acknowledgement/expired requested lease | `terminal/cancelled` |
| `executing` | expired lease without cancellation | `retry_waiting` or `terminal/failed` |
| `retry_waiting` | start due | `attempt_granted` |
| `retry_waiting` | cancellation | `terminal/cancelled` |
| `terminal` | any mutation | no accepted transition |

Immediate retry is available only to an ordinary live failed completion without
a cancellation request. All lease-expiry recovery is forced durable.

## Cross-Command Race Table

All races serialize on the authoritative aggregate transaction. “Wins” below
means commits first while satisfying database-time rules.

| Race | First accepted transition | Loser behavior |
| --- | --- | --- |
| competing starts with same basis | one grant uses one candidate | every later same-basis delivery is the same V1 command identity and is idempotent while that grant remains the latest acceptance |
| start versus cancellation from ready | start creates active attempt or cancellation terminalizes | cancellation then requests active cancel if start won; start is current if cancellation won |
| first heartbeat versus cancellation request | either may commit first | heartbeat remains allowed with request; cancellation remains pending |
| greater heartbeat versus expiry before deadline | heartbeat renews lease/version | old expiry version current |
| heartbeat at/after deadline versus expiry | expiry is logically eligible; heartbeat cannot renew | heartbeat current even if wake transaction has not run |
| success versus cancellation request before deadline | first transaction commits | cancel after success is current; success after request still wins completion and resolves request as superseded |
| failed completion versus cancellation request | failure first may retry/terminalize; request first suppresses retry | cancel applies to retry state if failure created it; failure after request terminalizes original failure |
| cancellation acknowledgement versus success/failure | first accepted completion for attempt/fence wins | different later completion conflicts because replay pair exists |
| completion before lease deadline versus expiry wake | completion terminalizes/retries | wake current |
| completion at/after lease deadline versus expiry wake | completion cannot accept; expiry recovery wins when processed | completion current |
| cancellation request versus expired active lease | request first makes expiry terminal cancellation | expiry first retries/fails; later cancel terminalizes retry state or observes terminal failure |
| duplicate heartbeat versus later cancellation | cancellation may replace latest acceptance | old duplicate becomes current and never renews twice |
| old expiry wake versus new attempt | attempt/fence or lease version differs | old wake current |
| old completion versus later attempt | matching accepted completion replays; absent expired-attempt completion is current | no later attempt is mutated |

### Completion Conflict After Another Winner

The first accepted completion for an attempt/fence stores canonical replay.
Any different later completion for that same pair conflicts, even when the
first completion caused retry and a later attempt is active or terminal. This
prevents a stale worker from rewriting accepted history.

Lease expiry is not an accepted completion. Therefore a post-expiry completion
without an earlier completion replay is current, not conflicting.

## Cancellation Resolution Table

| Starting cancellation state | Event | Resulting cancellation state/outcome |
| --- | --- | --- |
| not requested, no active attempt | request | resolved `without_active_attempt`, terminal cancelled |
| not requested, active | request | requested generation 1, phase remains active |
| requested, live current attempt | matching acknowledgement | resolved `acknowledged`, terminal cancelled |
| requested, expired current lease | matching expiry wake | resolved `lease_expired`, terminal cancelled |
| requested, live success | completion wins | resolved `superseded_by_completion`, terminal succeeded |
| requested, live failure | completion wins | resolved `superseded_by_completion`, terminal failed; no retry |
| requested | repeat request | idempotent only for exact latest acceptance, otherwise current |
| resolved/terminal | request | current terminal outcome |

No cancellation path returns to ready/retry/active without the request. V1 has
no withdrawal, pause, or resume command.

## Commit-Payload And Requested-Effect Ordering Closed By DTE03-E

DTE03-E uses these semantic orders when a variant applies. The first line
in each sequence is aggregate/evidence data in the accepting atomic commit, not
a requested-effect variant. Backticked later lines name only effect kinds
already admitted by DTE02.

### Start

```text
persist accepted grant evidence
-> `dispatch_attempt`
-> `wake_lease_expiry`
-> `publish_lifecycle_event`
-> `notify_current_state`
```

### Heartbeat

```text
persist renewal evidence
-> `cancel_obsolete_lease_wake` for the prior version
-> `wake_lease_expiry` for the new version
-> `publish_lifecycle_event` only for the first accepted heartbeat
-> `notify_current_state`
```

### Active Cancellation Request

```text
persist cancellation-request evidence
-> `request_execution_cancellation`
-> `publish_lifecycle_event`
-> `notify_current_state`
```

The current lease wake remains active.

### Cancellation Without An Active Attempt

```text
persist terminal-cancellation evidence
-> `publish_lifecycle_event`
-> `notify_current_state`
```

### Completion

```text
persist completion evidence
-> `cancel_obsolete_lease_wake`
-> `release_queue_ownership`
-> `continue_retry` or `wake_retry` when applicable
-> `publish_lifecycle_event`
-> `notify_current_state`
```

### Lease Recovery

```text
persist recovery evidence
-> `release_queue_ownership`
-> `wake_retry` when applicable
-> `publish_lifecycle_event`
-> `notify_current_state`
```

The matching lease-expiry wake is already being consumed, so recovery does not
request cancellation of that same wake. Terminal cancellation without an
active attempt leaves any earlier retry wake harmlessly stale through the
advanced run version; it does not require an unadmitted retry-wake cancellation
effect.

DTE03-E includes `publish_lifecycle_event` for start, first heartbeat, and
active cancellation. It follows that transition's dispatch/wake/cancel intents
and precedes `notify_current_state`. Later heartbeats omit the lifecycle event.

These are domain intent orders, not direct host calls. DTE03-E keeps evidence
separate from requested effects and cannot place dispatch/wake/cancel delivery
before the accepting state commit.

## Error And Current-State Boundary

The following are ordinary `current` outcomes, not typed errors:

- stale/lower/higher expected run version;
- start before eligible/not-before time;
- attempt or fence mismatch;
- duplicate/lower heartbeat without exact latest replay;
- heartbeat or completion after logical lease expiry;
- stale/different lease version;
- early matching expiry wake;
- mutation against a phase that cannot accept it; and
- mutation after terminal state.

Typed errors remain for:

- conflicting completion for an accepted pair;
- invalid cancellation acknowledgement;
- command schema failure before service execution;
- aggregate/replay/policy corruption;
- scope authority or store failure; and
- counter/timestamp exhaustion where no accepted lifecycle outcome exists.

This boundary makes duplicated infrastructure work harmless while keeping
semantic contradictions visible.

## Required DTE03-F Vectors And DTE-IP01 Tests

At minimum:

- competing start candidates and exact start replay;
- start before/at eligibility time;
- heartbeat sequence first, gap, duplicate, lower, and after intervening
  cancellation;
- heartbeat just before, exactly at, and after lease expiry;
- completion before first heartbeat;
- success/failure just before, exactly at, and after expiry;
- identical and conflicting completion after retry/later terminal state;
- request cancellation from ready, retry waiting, granted, and executing;
- repeated cancellation with same/different reason;
- acknowledgement with exact, absent, lower, and higher generation;
- success and failure after cancellation request;
- failure after cancellation suppresses retry;
- cancellation request versus lease expiry in both serialization orders;
- early expiry wake, duplicate expiry, stale lease version, and old-attempt wake;
- pre-heartbeat loss versus executing loss failure synthesis;
- expiry retry exhaustion and terminal original failure;
- lease-version monotonicity across attempts and renewals; and
- every accepted transition's run-version and effect-order invariants.

## Decisions Closed By DTE03-D

1. Lease version is run-local monotonic state retained across attempts.
2. Lease authority expires logically at database time `>= expiresAtMs`.
3. Exact direct replay is idempotent; older ordinary work is current.
4. Completion replay survives later transitions and conflicting completion is
   rejected.
5. Heartbeat gaps are accepted, duplicates never renew twice, and expired
   leases never resurrect.
6. Completion is valid before the first heartbeat while the grant lease is
   live.
7. Cancellation request remains orthogonal and does not revoke/renew lease.
8. Live success/failure may supersede requested cancellation; failure then
   terminalizes without retry.
9. Correct acknowledgement or requested-lease expiry terminalizes cancellation.
10. Lease loss without cancellation synthesizes fixed DTE03-C system failures
    and forces durable recovery.
11. Early expiry wake is current/no-write in V1.
12. Ordinary stale work returns current rather than becoming an exception.

## DTE03-F Closure And Handoff To DTE03-G

DTE03-E has encoded these tables into:

- five exact mutation outcome unions;
- exact `RunAttemptInspectionV1` phase projections;
- `TaskRunAttemptMutationAcceptanceV1` command identities and receipts;
- completion replay outcome/evidence/effect records;
- closed transition evidence kinds;
- exact requested-effect variants and ordering; and
- the final typed lifecycle/store/decision error union and evaluation order.

DTE03-F now proves those records against the complete race matrix through 65
canonical vectors and 37 exact named differences. DTE03-G must audit that the
fixtures did not change a phase destination, lease boundary, race winner,
replay duration, disposition, or typed-error/current distinction fixed here.

Do not create `packages/durable-task/` until DTE03-G admits the complete
lifecycle contract.

## Reopening Audit

DTE03-D does not reopen DTE01/DTE02:

- it adds no command or store operation;
- it changes no command field or identity representation;
- the lease cursor implements already-admitted monotonic lease versions;
- database time, candidate allocation, scope, and transaction remain store
  authorities;
- failure/retry policy remains DTE03-C's closed domain logic;
- no queue, alarm, Worker, provider, persistence, or Trigger type enters the
  aggregate; and
- no waitpoint, checkpoint, batch, pause, TTL, child-run, observability, or
  public behavior is admitted.

## Authority And Evidence

- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
- [`13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
- [`12-current-lifecycle-and-transition-inventory.md`](./12-current-lifecycle-and-transition-inventory.md)
- [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md)
- [`11-final-identity-admission.md`](./11-final-identity-admission.md)
- [`16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md)
- [`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- frozen Trigger start/completion/cancellation/heartbeat/stalled-execution
  source and admitted tests at commit
  `f10bc23785e569e5d917318cf2033aabdbe96a0b`
