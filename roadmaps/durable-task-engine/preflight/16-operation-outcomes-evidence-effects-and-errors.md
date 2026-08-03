# DTE03-E: Operation Outcomes, Inspection, Evidence, Effects, And Errors

## Receipt Status

**Status:** Complete — admit the exact DTE03-E service outcomes, current-state
inspection projection, mutation-acceptance/replay records, bounded transition
evidence, sequenced requested effects, typed error union, and evaluation order.

**Decision:** One authoritative transition produces one typed semantic outcome,
one bounded evidence record, and an exact ordered list of two to five durable
requested effects. Exact replay reconstructs the accepted receipt; ordinary
stale delivery returns a current-state projection; semantic contradiction uses
the typed error channel. Neither outcomes nor effects become execution or scope
authority.

This receipt encodes DTE03-D's already-fixed transitions. It does not change a
phase, retry decision, cancellation winner, lease boundary, or replay rule.
DTE03-F remains responsible for canonical compatibility vectors and executable
fixtures, and DTE03-G remains the final admission audit.

No package, database schema, migration, adapter, queue, scheduler, compute host,
route, observability API/UI, public SDK, or production activation is authorized.

## Fixed Inputs

DTE03-E assumes without reopening:

- DTE02's six service operations and two-method scope-bound store port;
- DTE03-B's five-phase aggregate, cancellation states, retry state, terminal
  outcomes, direct-acceptance slot, completion replays, and monotonic cursors;
- DTE03-C's failure, retry, attempt-limit, duration, and OOM policy;
- DTE03-D's logical lease deadline, accepted/idempotent/current distinctions,
  conflict behavior, transition tables, and race winners; and
- database time, fresh scope validation, transactional persistence, attempt/fence
  allocation, and effect-sequence validation as Task System store authorities.

## DTE02 Decision-Receipt And Effect-Sequence Correction

The earlier DTE02 draft says all three of these things:

1. the pure decision returns the already-final `next` aggregate;
2. that aggregate's latest acceptance and completion replay retain exact
   persisted effects and the updated requested-effect cursor; and
3. the store assigns effect sequences only after receiving unsequenced effects.

Those statements cannot all be implemented: a final aggregate cannot contain
the persisted acceptance receipt before its effect identities exist.

The earlier `no_change/idempotent` member also returns only `outcome`. That is
insufficient to reconstruct the original observed time, accepted run version,
evidence, and sequenced effects promised by `RunAttemptServiceReceiptV1`, and it
cannot identify an older completion replay receipt.

DTE03-E closes the gap without adding a command, port method, callback, or host
authority:

- the pure decision derives the only valid contiguous sequence range from the
  decoded `requestedEffectCursor` and its ordered effect array;
- every returned effect is wrapped as `PersistedTaskRequestedEffectV1` with its
  proposed sequence;
- the next aggregate advances its cursor to the exact proposed last sequence
  and stores the same sequenced effects in its acceptance/replay receipt;
- the store independently validates cursor basis, contiguity, count, run ID,
  accepted run version, array order, and overflow before committing;
- a mismatch is rejected with no write; and
- the store's successful transactional validation is the authoritative
  assignment. The decision cannot choose an arbitrary starting sequence.

For no-change decisions:

- `idempotent` returns the exact stored accepted-receipt data selected by direct
  or completion replay; and
- `current` returns only its current outcome, while the store supplies the
  current transaction observation time/version and empty evidence/effects.

The corrected commit member is therefore:

```ts
type TaskRunAttemptDecisionV1<Outcome> =
  | {
      readonly kind: "no_change";
      readonly disposition: "idempotent";
      readonly replay: TaskRunAttemptAcceptedReceiptV1<Outcome>;
    }
  | {
      readonly kind: "no_change";
      readonly disposition: "current";
      readonly outcome: Outcome;
    }
  | {
      readonly kind: "commit";
      readonly expectedRunVersion: TaskRunVersionV1;
      readonly next: TaskRunAttemptAggregateV1;
      readonly evidence: readonly TaskRunAttemptEvidenceV1[];
      readonly requestedEffects:
        readonly PersistedTaskRequestedEffectV1[];
      readonly outcome: Outcome;
    };
```

This keeps the decision deterministic and makes the aggregate, acceptance,
completion replay, evidence, effect records, and cursor one atomic value. The
decision reads no clock/random source and performs no I/O. Sequence exhaustion
is `TaskRunAttemptCounterExhaustedError`, not wraparound or partial persistence.
An idempotent result writes nothing and returns `replay`; it never re-derives or
re-sequences accepted data.

For a commit, top-level `outcome`, `evidence`, and `requestedEffects` are exactly
equal to `next.lastLifecycleAcceptance.accepted` members. A completion commit's
new replay `accepted` member is the same value as well. The store rejects any
disagreement before writing; these are not three independently editable copies.

## Shared Current-State Projection

Mutation `current` outcomes and inspection use one host-neutral state projection
instead of returning the aggregate. The projection deliberately omits bound
policy, retry jitter, grant-basis version, histories, completion replays,
acceptance receipts, effect cursors, effect delivery state, scope, and physical
storage data.

```ts
interface TaskAttemptLeaseProjectionV1 {
  readonly version: TaskLeaseVersionV1;
  readonly renewedAtMs: TaskDatabaseTimeMsV1;
  readonly expiresAtMs: TaskDatabaseTimeMsV1;
}

interface TaskActiveAttemptProjectionV1 {
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly lease: TaskAttemptLeaseProjectionV1;
}

interface RunAttemptStateBaseV1 {
  readonly version: "flarex.run-attempt-state.v1";
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly runVersion: TaskRunVersionV1;
}

type RunAttemptStateV1 =
  | (RunAttemptStateBaseV1 & {
      readonly phase: "ready";
      readonly ready: TaskRunReadyStateV1;
      readonly cancellation: TaskCancellationNotRequestedV1;
    })
  | (RunAttemptStateBaseV1 & {
      readonly phase: "attempt_granted";
      readonly currentAttempt: TaskActiveAttemptProjectionV1;
      readonly heartbeat: { readonly kind: "none_accepted" };
      readonly cancellation:
        | TaskCancellationNotRequestedV1
        | TaskCancellationRequestedV1;
    })
  | (RunAttemptStateBaseV1 & {
      readonly phase: "executing";
      readonly currentAttempt: TaskActiveAttemptProjectionV1;
      readonly heartbeat: {
        readonly kind: "accepted";
        readonly highestSequence: TaskHeartbeatSequenceV1;
      };
      readonly cancellation:
        | TaskCancellationNotRequestedV1
        | TaskCancellationRequestedV1;
    })
  | (RunAttemptStateBaseV1 & {
      readonly phase: "retry_waiting";
      readonly retry: TaskAcceptedRetryV1;
      readonly cancellation: TaskCancellationNotRequestedV1;
    })
  | (RunAttemptStateBaseV1 &
      { readonly phase: "terminal" } &
      (
        | {
            readonly terminal: Extract<
              TaskRunTerminalOutcomeV1,
              { readonly kind: "succeeded" | "failed" }
            >;
            readonly cancellation:
              | TaskCancellationNotRequestedV1
              | (TaskCancellationResolvedV1 & {
                  readonly resolution: "superseded_by_completion";
                });
          }
        | {
            readonly terminal: Extract<
              TaskRunTerminalOutcomeV1,
              { readonly kind: "cancelled" }
            >;
            readonly cancellation: TaskCancellationResolvedV1 & {
              readonly resolution:
                | "without_active_attempt"
                | "acknowledged"
                | "lease_expired";
            };
          }
      ));

interface RunAttemptInspectionV1 {
  readonly version: "flarex.run-attempt-inspection.v1";
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly state: RunAttemptStateV1;
}
```

`observedAtMs` and the state come from the same fresh read transaction. An
inspection performs no mutation and has no disposition, evidence, or effects.
The state is a detached immutable projection, not a live aggregate reference.
For terminal cancellation, the cancellation generation, reason, request time,
resolution, and resolved/completed time must equal the terminal outcome; Schema
cross-field validation rejects disagreement.

This inspection is not Trigger's observability API, live subscription, run
timeline, log stream, or UI response. A later observability roadmap may project
it and lifecycle events into tenant-facing reads without making those reads
transition authority.

## Exact Attempt Grant

The successful start value is:

```ts
interface TaskAttemptGrantV1 {
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly lease: TaskAttemptLeaseProjectionV1;
}
```

It excludes retry jitter, scope, deployment, artifact location, queue target,
provider placement, credentials, worker identity, and transaction data. The
runtime host resolves the captured definition revision through its separately
authorized binding path.

## Exact Mutation Outcome Unions

### Shared Retry Delivery

```ts
type TaskRetryDeliveryV1 = "immediate" | "durable";
```

`immediate` means persisted `ready/immediate_retry` plus `continue_retry`.
`durable` means persisted `retry_waiting` plus `wake_retry`.

### `StartAttemptOutcomeV1`

```ts
type StartAttemptCurrentReasonV1 =
  | "stale_run_version"
  | "not_yet_eligible"
  | "phase_not_startable";

type StartAttemptOutcomeV1 =
  | {
      readonly kind: "attempt_granted";
      readonly grant: TaskAttemptGrantV1;
    }
  | {
      readonly kind: "current";
      readonly reason: StartAttemptCurrentReasonV1;
      readonly state: RunAttemptStateV1;
    };
```

After exact direct replay, version mismatch wins over phase/timing detail;
matching ready/retry state before its time is `not_yet_eligible`; every other
non-startable matching-version phase is `phase_not_startable`.

### `HeartbeatAttemptOutcomeV1`

```ts
type HeartbeatAttemptCurrentReasonV1 =
  | "phase_not_active"
  | "stale_attempt"
  | "stale_fence"
  | "lease_expired"
  | "heartbeat_not_advanced";

type HeartbeatAttemptOutcomeV1 =
  | {
      readonly kind: "lease_renewed";
      readonly attempt: TaskTerminalAttemptRefV1;
      readonly heartbeatSequence: TaskHeartbeatSequenceV1;
      readonly enteredExecuting: boolean;
      readonly lease: TaskAttemptLeaseProjectionV1;
    }
  | {
      readonly kind: "current";
      readonly reason: HeartbeatAttemptCurrentReasonV1;
      readonly state: RunAttemptStateV1;
    };
```

`enteredExecuting` is true only for the first accepted heartbeat. After direct
replay, current-reason order is phase, attempt, fence, lease time, then sequence.
Equal/lower sequence is `heartbeat_not_advanced`; a gap is accepted.

### `CompleteAttemptOutcomeV1`

The DTE03-B terminal members receive names without changing their fields:

```ts
type TaskRunSucceededTerminalV1 = Extract<
  TaskRunTerminalOutcomeV1,
  { readonly kind: "succeeded" }
>;
type TaskRunCancelledTerminalV1 = Extract<
  TaskRunTerminalOutcomeV1,
  { readonly kind: "cancelled" }
>;
type TaskRunFailedTerminalV1 = Extract<
  TaskRunTerminalOutcomeV1,
  { readonly kind: "failed" }
>;

type TaskRunAttemptFailedTerminalV1 = TaskRunFailedTerminalV1 & {
  readonly attempt: TaskTerminalAttemptRefV1;
};

type TaskRunCancelledWithoutAttemptTerminalV1 =
  TaskRunCancelledTerminalV1 & {
    readonly attempt: null;
    readonly resolution: "without_active_attempt";
    readonly executionDurationMs: null;
  };

type TaskRunAcknowledgedCancellationTerminalV1 =
  TaskRunCancelledTerminalV1 & {
    readonly attempt: TaskTerminalAttemptRefV1;
    readonly resolution: "acknowledged";
  };

type TaskRunLeaseExpiredCancellationTerminalV1 =
  TaskRunCancelledTerminalV1 & {
    readonly attempt: TaskTerminalAttemptRefV1;
    readonly resolution: "lease_expired";
    readonly executionDurationMs: null;
  };

type TaskCompletionTerminalCancellationStateV1 =
  | TaskCancellationNotRequestedV1
  | (TaskCancellationResolvedV1 & {
      readonly resolution: "superseded_by_completion";
    });

type CompleteAttemptCurrentReasonV1 =
  | "phase_not_active"
  | "stale_attempt"
  | "stale_fence"
  | "lease_expired";

type CompleteAttemptOutcomeV1 =
  | {
      readonly kind: "terminal_succeeded";
      readonly terminal: TaskRunSucceededTerminalV1;
      readonly cancellation: TaskCompletionTerminalCancellationStateV1;
    }
  | {
      readonly kind: "retry_scheduled";
      readonly delivery: TaskRetryDeliveryV1;
      readonly retry: TaskAcceptedRetryV1;
    }
  | {
      readonly kind: "terminal_failed";
      readonly terminal: TaskRunAttemptFailedTerminalV1;
      readonly cancellation: TaskCompletionTerminalCancellationStateV1;
    }
  | {
      readonly kind: "terminal_cancelled";
      readonly terminal: TaskRunAcknowledgedCancellationTerminalV1;
    }
  | {
      readonly kind: "current";
      readonly reason: CompleteAttemptCurrentReasonV1;
      readonly state: RunAttemptStateV1;
    };
```

Completion replay lookup precedes this current-reason order. An identical
accepted completion returns its original non-current outcome as idempotent. A
different completion for the pair is a typed conflict. With no replay, current
reason order is phase, attempt, fence, then logical lease time. For an exact
active pair, invalid cancellation acknowledgement is a typed error before the
lease-time check, as fixed by DTE03-D.

### `RequestCancellationOutcomeV1`

```ts
type RequestCancellationCurrentReasonV1 =
  | "already_requested"
  | "already_terminal";

type RequestCancellationOutcomeV1 =
  | {
      readonly kind: "cancellation_requested";
      readonly attempt: TaskTerminalAttemptRefV1;
      readonly cancellation: TaskCancellationRequestedV1;
    }
  | {
      readonly kind: "terminal_cancelled";
      readonly terminal: TaskRunCancelledWithoutAttemptTerminalV1;
    }
  | {
      readonly kind: "current";
      readonly reason: RequestCancellationCurrentReasonV1;
      readonly state: RunAttemptStateV1;
    };
```

An exact latest cancellation acceptance returns its original requested or
terminal outcome as idempotent. After an intervening acceptance, any active
request returns `already_requested`; a terminal run returns `already_terminal`.
The first reason remains stored and is never replaced by the current outcome.

### `HandleLeaseExpiryOutcomeV1`

```ts
type HandleLeaseExpiryCurrentReasonV1 =
  | "phase_not_active"
  | "stale_attempt"
  | "stale_fence"
  | "stale_lease_version"
  | "lease_not_expired";

type HandleLeaseExpiryOutcomeV1 =
  | {
      readonly kind: "retry_scheduled";
      readonly delivery: "durable";
      readonly retry: TaskAcceptedRetryV1;
    }
  | {
      readonly kind: "terminal_failed";
      readonly terminal: TaskRunAttemptFailedTerminalV1;
    }
  | {
      readonly kind: "terminal_cancelled";
      readonly terminal: TaskRunLeaseExpiredCancellationTerminalV1;
    }
  | {
      readonly kind: "current";
      readonly reason: HandleLeaseExpiryCurrentReasonV1;
      readonly state: RunAttemptStateV1;
    };
```

After direct replay, reason order is phase, attempt, fence, lease version, then
database time. Lease-loss retry is always durable; this outcome cannot contain
`delivery: "immediate"`.

## Disposition And Outcome Compatibility

| Operation | `accepted` | `idempotent` | `current` |
| --- | --- | --- | --- |
| start | `attempt_granted` | stored `attempt_granted` | `current` only |
| heartbeat | `lease_renewed` | stored `lease_renewed` | `current` only |
| completion | any non-current completion outcome | stored non-current completion outcome | `current` only |
| cancellation | `cancellation_requested` or `terminal_cancelled` | stored accepted outcome | `current` only |
| lease expiry | retry or terminal outcome | stored accepted outcome | `current` only |

No accepted or idempotent receipt contains a `current` outcome. No current
receipt contains an earlier accepted outcome. Typed conflicts and invalid
acknowledgements produce no receipt.

## Exact Accepted Mutation And Replay Records

### Accepted Receipt Data

```ts
interface TaskRunAttemptAcceptedReceiptV1<Outcome> {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly resultingPhase: RunAttemptPhaseV1;
  readonly outcome: Outcome;
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly requestedEffects:
    readonly PersistedTaskRequestedEffectV1[];
}
```

It intentionally has no disposition. The accepting call projects `accepted`;
exact replay projects `idempotent` while reusing this stored data.

### Canonical Direct Command Identities

```ts
type TaskRunAttemptDirectCommandIdentityV1 =
  | {
      readonly kind: "start_attempt";
      readonly expectedRunVersion: TaskRunVersionV1;
    }
  | {
      readonly kind: "heartbeat_attempt";
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly heartbeatSequence: TaskHeartbeatSequenceV1;
    }
  | {
      readonly kind: "request_cancellation";
      readonly reason: TaskCancellationReasonV1;
    }
  | {
      readonly kind: "handle_lease_expiry";
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly expectedLeaseVersion: TaskLeaseVersionV1;
    };
```

The run ID is supplied by the enclosing aggregate and cannot disagree with it.
Start jitter is intentionally absent because the basis version is the admitted
direct replay identity. Completion is absent because it uses the longer replay
record below, not the direct slot.

### Latest Mutation Acceptance

```ts
type TaskRunAttemptMutationAcceptanceV1 =
  | {
      readonly kind: "start_attempt";
      readonly command: Extract<
        TaskRunAttemptDirectCommandIdentityV1,
        { readonly kind: "start_attempt" }
      >;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<
        Extract<StartAttemptOutcomeV1, { readonly kind: "attempt_granted" }>
      >;
    }
  | {
      readonly kind: "heartbeat_attempt";
      readonly command: Extract<
        TaskRunAttemptDirectCommandIdentityV1,
        { readonly kind: "heartbeat_attempt" }
      >;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<
        Extract<HeartbeatAttemptOutcomeV1, { readonly kind: "lease_renewed" }>
      >;
    }
  | {
      readonly kind: "complete_attempt";
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<
        Exclude<CompleteAttemptOutcomeV1, { readonly kind: "current" }>
      >;
    }
  | {
      readonly kind: "request_cancellation";
      readonly command: Extract<
        TaskRunAttemptDirectCommandIdentityV1,
        { readonly kind: "request_cancellation" }
      >;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<
        Exclude<RequestCancellationOutcomeV1, { readonly kind: "current" }>
      >;
    }
  | {
      readonly kind: "handle_lease_expiry";
      readonly command: Extract<
        TaskRunAttemptDirectCommandIdentityV1,
        { readonly kind: "handle_lease_expiry" }
      >;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<
        Exclude<HandleLeaseExpiryOutcomeV1, { readonly kind: "current" }>
      >;
    };
```

Completion occupies the latest slot so the newest accepted mutation remains
inspectable internally, but completion replay never depends on that slot.

### Completion Replay Refinement

DTE03-B's replay record nests
`TaskRunAttemptAcceptedReceiptV1<Exclude<CompleteAttemptOutcomeV1,
{ kind: "current" }>>` as `accepted`. The pure idempotent decision returns that
member directly. When the completion is also the latest mutation, its latest
acceptance `accepted` member is exactly equal to the replay receipt.

The replay's stored full completion retains the first accepted diagnostic
message, while DTE03-D's canonical equality excludes that message. Its accepted
receipt contains the one evidence record and exact sequenced effect list.

There is exactly one replay per accepted attempt/fence completion and at most
250 entries. A retry-causing completion remains replayable after later attempts.

## Exact Transition Evidence

### Failure Policy Decision Evidence

```ts
type TaskFailurePolicyDecisionEvidenceV1 = {
  readonly failure: TaskExecutionFailureV1;
  readonly currentAttemptNumber: TaskAttemptNumberV1;
  readonly maximumAttempts: TaskMaximumAttemptsV1;
  readonly directive:
    | {
        readonly source: "completion";
        readonly value: TaskRetryDirectiveV1;
      }
    | {
        readonly source: "synthesized_bound_policy";
        readonly value: { readonly kind: "use_bound_policy" };
      };
  readonly storedRetryJitter: TaskRetryJitterV1;
  readonly jitterUsed: boolean;
  readonly decision:
    | ({
        readonly kind: "retry_accepted";
        readonly delaySource: "bound_policy" | "override_delay";
        readonly delayMs: TaskDurationMsV1;
        readonly notBeforeMs: TaskDatabaseTimeMsV1;
      } &
        (
          | {
              readonly eligibility: "ordinary";
              readonly delivery:
                | {
                    readonly kind: "immediate";
                    readonly reason: "below_immediate_threshold";
                  }
                | {
                    readonly kind: "durable";
                    readonly reason:
                      | "failure_code_forced_durable"
                      | "at_or_above_immediate_threshold";
                  };
              readonly computeEscalation: null;
            }
          | {
              readonly eligibility: "oom_escalation";
              readonly delivery: {
                readonly kind: "durable";
                readonly reason: "oom_forced_durable";
              };
              readonly computeEscalation: {
                readonly previous: TaskComputeProfileRefV1;
                readonly next: TaskComputeProfileRefV1;
              };
            }
          | {
              readonly eligibility: "lease_loss";
              readonly delivery: {
                readonly kind: "durable";
                readonly reason: "lease_loss_forced_durable";
              };
              readonly computeEscalation: null;
            }
        ))
    | {
        readonly kind: "retry_rejected";
        readonly reason:
          | "cancellation_requested"
          | "directive_do_not_retry"
          | "attempt_limit_reached"
          | "failure_never_retry"
          | "oom_escalation_disabled"
          | "oom_target_not_different";
        readonly terminalClassification: TaskTerminalFailureClassV1;
      };
};
```

`jitterUsed` is true only when an accepted bound-policy calculation has
`randomize: true`; override delay and every rejected retry set it false. A
non-null compute escalation is legal only for accepted OOM/possible-OOM retry,
must change profile, and requires durable delivery. Lease-loss evidence uses
`directive.source: "synthesized_bound_policy"`, `eligibility: "lease_loss"`,
and durable delivery. Failed completion uses `source: "completion"` and the
exact command directive.

The decision record explains policy; it is never read back as policy input.
Delay/not-before fields exist only when retry was accepted, and terminal class
exists only when retry was rejected.

### Common Evidence Fields

```ts
interface TaskRunAttemptEvidenceBaseV1 {
  readonly version: "flarex.task-run-attempt-evidence.v1";
  readonly runId: TaskRunIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly recordedAtMs: TaskDatabaseTimeMsV1;
  readonly resultingPhase: RunAttemptPhaseV1;
}
```

### Closed Evidence Union

```ts
type TaskRunAttemptEvidenceV1 = TaskRunAttemptEvidenceBaseV1 &
  (
    | {
        readonly kind: "attempt_granted";
        readonly fromPhase: "ready" | "retry_waiting";
        readonly grant: TaskAttemptGrantV1;
      }
    | {
        readonly kind: "heartbeat_accepted";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly heartbeatSequence: TaskHeartbeatSequenceV1;
        readonly previousLeaseVersion: TaskLeaseVersionV1;
        readonly renewedLease: TaskAttemptLeaseProjectionV1;
        readonly enteredExecuting: boolean;
      }
    | {
        readonly kind: "completion_succeeded";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly completion: Extract<
          TaskAttemptCompletionV1,
          { readonly kind: "succeeded" }
        >;
        readonly outcome: Extract<
          CompleteAttemptOutcomeV1,
          { readonly kind: "terminal_succeeded" }
        >;
      }
    | {
        readonly kind: "completion_failed";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly completion: Extract<
          TaskAttemptCompletionV1,
          { readonly kind: "failed" }
        >;
        readonly policy: TaskFailurePolicyDecisionEvidenceV1;
        readonly outcome:
          | Extract<
              CompleteAttemptOutcomeV1,
              { readonly kind: "retry_scheduled" }
            >
          | Extract<
              CompleteAttemptOutcomeV1,
              { readonly kind: "terminal_failed" }
            >;
      }
    | {
        readonly kind: "completion_cancellation_acknowledged";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly completion: Extract<
          TaskAttemptCompletionV1,
          { readonly kind: "cancellation_acknowledged" }
        >;
        readonly outcome: Extract<
          CompleteAttemptOutcomeV1,
          { readonly kind: "terminal_cancelled" }
        >;
      }
    | {
        readonly kind: "cancellation_requested";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly cancellation: TaskCancellationRequestedV1;
        readonly outcome: Extract<
          RequestCancellationOutcomeV1,
          { readonly kind: "cancellation_requested" }
        >;
      }
    | {
        readonly kind: "cancellation_resolved_without_attempt";
        readonly attempt: null;
        readonly cancellation: TaskCancellationResolvedV1 & {
          readonly resolution: "without_active_attempt";
        };
        readonly outcome: Extract<
          RequestCancellationOutcomeV1,
          { readonly kind: "terminal_cancelled" }
        >;
      }
    | {
        readonly kind: "lease_expiry_recovered";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly expiredLeaseVersion: TaskLeaseVersionV1;
        readonly sourcePhase: "attempt_granted" | "executing";
        readonly policy: TaskFailurePolicyDecisionEvidenceV1;
        readonly outcome:
          | Extract<
              HandleLeaseExpiryOutcomeV1,
              { readonly kind: "retry_scheduled" }
            >
          | Extract<
              HandleLeaseExpiryOutcomeV1,
              { readonly kind: "terminal_failed" }
            >;
      }
    | {
        readonly kind: "lease_expiry_cancelled";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly expiredLeaseVersion: TaskLeaseVersionV1;
        readonly sourcePhase: "attempt_granted" | "executing";
        readonly outcome: Extract<
          HandleLeaseExpiryOutcomeV1,
          { readonly kind: "terminal_cancelled" }
        >;
      }
  );
```

Every accepted DTE-IP01 mutation produces exactly one evidence record.
`acceptedRunVersion`, `recordedAtMs`, and `resultingPhase` exactly match its
acceptance. Current decisions return an empty evidence array. Idempotent replay
returns the stored one-record array and never appends another record.

Failure evidence has mandatory cross-field agreement:

- completion failure/directive equal `policy.failure`/`policy.directive.value`;
- lease recovery uses the phase-specific synthesized DTE03-C failure and
  `use_bound_policy` directive;
- accepted `delaySource` is `bound_policy` for `use_bound_policy` and
  `override_delay` for an override directive; `do_not_retry` is rejected;
- accepted policy delay, not-before time, delivery kind, and next compute
  profile equal `TaskAcceptedRetryV1` and the retry outcome;
- rejected policy terminal classification equals the terminal outcome;
- cancellation-requested rejection exists only with terminal failure and a
  `superseded_by_completion` cancellation resolution; and
- lease-expiry cancellation has no failure-policy decision.

Any mismatch decodes as corruption or rejects a proposed next state; evidence
never overrides the outcome or aggregate.

Evidence is receipt/replay evidence, not an unbounded heartbeat timeline:

- the aggregate retains only the latest ordinary acceptance evidence;
- completion replay retains at most one evidence record per attempt;
- replaced non-completion acceptance evidence has no aggregate retention
  requirement after its effects are durably persisted;
- Roadmap 04 may normalize and compact delivered effect/evidence rows without
  breaking direct or completion replay; and
- a later observability store owns any longer tenant-visible timeline.

Evidence contains only closed bounded domain values. It contains no raw result,
stack, foreign cause, SQL row, scope, artifact location, queue/provider record,
log, trace, metadata map, or arbitrary JSON.

## Exact Requested Effect Contract

### Common Effect Fields

```ts
interface TaskRequestedEffectBaseV1 {
  readonly version: "flarex.task-requested-effect.v1";
  readonly runId: TaskRunIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
}
```

### Bounded Lifecycle Event Projection

```ts
type ProjectTaskExecutionFailureForEventV1<Failure> =
  Failure extends TaskExecutionFailureV1
    ? Pick<Failure, "kind" | "code">
    : never;

type TaskExecutionFailureEventProjectionV1 =
  ProjectTaskExecutionFailureForEventV1<TaskExecutionFailureV1>;

type TaskLifecycleEventProjectionV1 =
  | {
      readonly kind: "attempt_granted";
      readonly attemptNumber: TaskAttemptNumberV1;
    }
  | {
      readonly kind: "execution_observed";
      readonly attemptNumber: TaskAttemptNumberV1;
    }
  | {
      readonly kind: "cancellation_requested";
      readonly attemptNumber: TaskAttemptNumberV1;
      readonly generation: TaskCancellationGenerationV1;
      readonly reasonCode: TaskCancellationReasonV1["code"];
    }
  | {
      readonly kind: "retry_scheduled";
      readonly previousAttemptNumber: TaskAttemptNumberV1;
      readonly retry:
        | {
            readonly source: "failed_completion";
            readonly delivery: TaskRetryDeliveryV1;
          }
        | {
            readonly source: "lease_expiry";
            readonly delivery: "durable";
          };
      readonly notBeforeMs: TaskDatabaseTimeMsV1;
    }
  | {
      readonly kind: "run_succeeded";
      readonly attemptNumber: TaskAttemptNumberV1;
      readonly hasResult: boolean;
    }
  | {
      readonly kind: "run_cancelled";
      readonly generation: TaskCancellationGenerationV1;
      readonly reasonCode: TaskCancellationReasonV1["code"];
      readonly cancellation:
        | {
            readonly attemptNumber: null;
            readonly resolution: "without_active_attempt";
          }
        | {
            readonly attemptNumber: TaskAttemptNumberV1;
            readonly resolution: "acknowledged" | "lease_expired";
          };
    }
  | {
      readonly kind: "run_failed";
      readonly attemptNumber: TaskAttemptNumberV1 | null;
      readonly failure: TaskExecutionFailureEventProjectionV1;
    };
```

This event is a bounded post-commit projection. It carries no failure message,
result digest/body, cancellation reason message, pricing, logs, trace context,
tenant/product metadata, or arbitrary payload.

The event union preserves semantic correlation: lease-expiry retry is always
durable, cancellation without an active attempt has a null attempt number,
acknowledged/lease-expired cancellation has a positive attempt number, and the
failure kind owns its allowed code. Terminal failure classification is derived
from the failure kind rather than repeated as a second possibly inconsistent
field.

### Closed Effect Union

```ts
type TaskRequestedEffectV1 = TaskRequestedEffectBaseV1 &
  (
    | {
        readonly kind: "dispatch_attempt";
        readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly leaseVersion: TaskLeaseVersionV1;
        readonly computeProfile: TaskComputeProfileRefV1;
      }
    | {
        readonly kind: "continue_retry";
        readonly expectedRunVersion: TaskRunVersionV1;
        readonly notBeforeMs: TaskDatabaseTimeMsV1;
      }
    | {
        readonly kind: "wake_retry";
        readonly expectedRunVersion: TaskRunVersionV1;
        readonly notBeforeMs: TaskDatabaseTimeMsV1;
      }
    | {
        readonly kind: "wake_lease_expiry";
        readonly attemptId: TaskAttemptIdV1;
        readonly executionFence: TaskExecutionFenceV1;
        readonly expectedLeaseVersion: TaskLeaseVersionV1;
        readonly notBeforeMs: TaskDatabaseTimeMsV1;
      }
    | {
        readonly kind: "request_execution_cancellation";
        readonly attemptId: TaskAttemptIdV1;
        readonly executionFence: TaskExecutionFenceV1;
        readonly cancellationGeneration: TaskCancellationGenerationV1;
      }
    | {
        readonly kind: "release_queue_ownership";
        readonly cause:
          | "succeeded_completion"
          | "failed_completion"
          | "cancellation_acknowledged"
          | "lease_expired_before_heartbeat"
          | "lease_expired_after_heartbeat"
          | "cancellation_lease_expired";
      }
    | {
        readonly kind: "publish_lifecycle_event";
        readonly observedAtMs: TaskDatabaseTimeMsV1;
        readonly event: TaskLifecycleEventProjectionV1;
      }
    | {
        readonly kind: "notify_current_state";
      }
    | {
        readonly kind: "cancel_obsolete_lease_wake";
        readonly attemptId: TaskAttemptIdV1;
        readonly executionFence: TaskExecutionFenceV1;
        readonly obsoleteLeaseVersion: TaskLeaseVersionV1;
      }
  );

interface PersistedTaskRequestedEffectV1 {
  readonly sequence: TaskRequestedEffectSequenceV1;
  readonly effect: TaskRequestedEffectV1;
}
```

For every effect in one acceptance, `effect.runId` equals the aggregate run,
and `effect.acceptedRunVersion` equals the accepted next run version. Every
version field nested in an effect must agree with that accepted state. A
`publish_lifecycle_event.observedAtMs` equals the acceptance/evidence database
time.

The persisted identity is scope-bound `(effect.runId, sequence)`. Sequence does
not authorize delivery or a lifecycle mutation. Delivery adapters reacquire
their operation capability and use expected run/lease/fence fields only as
stale-work guards.

## Exact Effect Lists And Order

The first proposed sequence is cursor-plus-one and the remainder are contiguous
in the following exact array order:

| Accepted transition | Exact effect kinds in order |
| --- | --- |
| start grant | `dispatch_attempt`, `wake_lease_expiry`, `publish_lifecycle_event(attempt_granted)`, `notify_current_state` |
| first heartbeat | `cancel_obsolete_lease_wake`, `wake_lease_expiry`, `publish_lifecycle_event(execution_observed)`, `notify_current_state` |
| later greater heartbeat | `cancel_obsolete_lease_wake`, `wake_lease_expiry`, `notify_current_state` |
| active cancellation request | `request_execution_cancellation`, `publish_lifecycle_event(cancellation_requested)`, `notify_current_state` |
| cancellation without active attempt | `publish_lifecycle_event(run_cancelled)`, `notify_current_state` |
| successful completion | `cancel_obsolete_lease_wake`, `release_queue_ownership`, `publish_lifecycle_event(run_succeeded)`, `notify_current_state` |
| failed completion with immediate retry | `cancel_obsolete_lease_wake`, `release_queue_ownership`, `continue_retry`, `publish_lifecycle_event(retry_scheduled)`, `notify_current_state` |
| failed completion with durable retry | `cancel_obsolete_lease_wake`, `release_queue_ownership`, `wake_retry`, `publish_lifecycle_event(retry_scheduled)`, `notify_current_state` |
| terminal failed completion | `cancel_obsolete_lease_wake`, `release_queue_ownership`, `publish_lifecycle_event(run_failed)`, `notify_current_state` |
| acknowledged cancellation | `cancel_obsolete_lease_wake`, `release_queue_ownership`, `publish_lifecycle_event(run_cancelled)`, `notify_current_state` |
| lease-expiry retry | `release_queue_ownership`, `wake_retry`, `publish_lifecycle_event(retry_scheduled)`, `notify_current_state` |
| lease-expiry terminal failure | `release_queue_ownership`, `publish_lifecycle_event(run_failed)`, `notify_current_state` |
| lease-expiry cancellation | `release_queue_ownership`, `publish_lifecycle_event(run_cancelled)`, `notify_current_state` |

A failed completion after a pending cancellation uses the terminal-failed list,
never a retry list. The lease-expiry handler does not cancel the wake currently
being consumed. A retry wake made stale by cancellation needs no cancellation
effect. Current and typed-error decisions return zero effects. Idempotent replay
returns the exact stored sequence/effect pairs.

No accepted DTE-IP01 mutation emits more than five effects. Unsupported extra,
missing, duplicate, reordered, wrong-version, or noncontiguous effects are a
decision/store contract failure, not best-effort behavior.

## Exact Typed Error Contract

### Operation Name

```ts
type RunAttemptOperationV1 =
  | "start_attempt"
  | "heartbeat_attempt"
  | "complete_attempt"
  | "request_cancellation"
  | "handle_lease_expiry"
  | "inspect_current_attempt";

type RunAttemptMutationOperationV1 = Exclude<
  RunAttemptOperationV1,
  "inspect_current_attempt"
>;
```

### Command Decode Error

```ts
interface InvalidRunAttemptCommandError {
  readonly _tag: "InvalidRunAttemptCommandError";
  readonly operation: RunAttemptOperationV1;
  readonly issue:
    | "invalid_shape"
    | "invalid_identifier"
    | "invalid_number"
    | "invalid_completion"
    | "invalid_cancellation_reason";
}
```

It contains no raw value, arbitrary schema message, path derived from caller
keys, or cause. The operation-specific decoder maps the first issue in declared
Schema evaluation order to this closed code; caller object-key order cannot
change it. It is produced before service invocation.

### Decision Error Union

```ts
interface InvalidRunAttemptTransitionError {
  readonly _tag: "InvalidRunAttemptTransitionError";
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly phase: RunAttemptPhaseV1;
  readonly reason:
    | "candidate_missing"
    | "candidate_unexpected"
    | "next_state_invalid"
    | "acceptance_invalid"
    | "completion_replay_invalid"
    | "evidence_invalid"
    | "effect_order_invalid";
}

interface StaleTaskRunVersionError {
  readonly _tag: "StaleTaskRunVersionError";
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason: "commit_basis_disagrees_with_decoded_state";
}

interface StaleTaskExecutionFenceError {
  readonly _tag: "StaleTaskExecutionFenceError";
  readonly operation:
    | "heartbeat_attempt"
    | "complete_attempt"
    | "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly reason: "accepted_transition_uses_noncurrent_fence";
}

interface ConflictingTaskAttemptCompletionError {
  readonly _tag: "ConflictingTaskAttemptCompletionError";
  readonly operation: "complete_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly acceptedKind: TaskAttemptCompletionV1["kind"];
  readonly receivedKind: TaskAttemptCompletionV1["kind"];
}

interface InvalidTaskCancellationAcknowledgementError {
  readonly _tag: "InvalidTaskCancellationAcknowledgementError";
  readonly operation: "complete_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly requestedGeneration: TaskCancellationGenerationV1 | null;
  readonly receivedGeneration: TaskCancellationGenerationV1;
}

interface TaskRunAttemptPolicyError {
  readonly _tag: "TaskRunAttemptPolicyError";
  readonly operation:
    | "start_attempt"
    | "heartbeat_attempt"
    | "complete_attempt"
    | "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "invalid_bound_policy"
    | "attempt_limit_invariant"
    | "retry_delay_overflow"
    | "eligibility_time_overflow"
    | "lease_expiry_time_overflow"
    | "compute_escalation_invalid";
}

interface TaskRunAttemptCounterExhaustedError {
  readonly _tag: "TaskRunAttemptCounterExhaustedError";
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly counter:
    | "run_version"
    | "attempt_number"
    | "lease_version"
    | "cancellation_generation"
    | "requested_effect_sequence";
}

type RunAttemptDecisionErrorV1 =
  | InvalidRunAttemptTransitionError
  | StaleTaskRunVersionError
  | StaleTaskExecutionFenceError
  | ConflictingTaskAttemptCompletionError
  | InvalidTaskCancellationAcknowledgementError
  | TaskRunAttemptPolicyError
  | TaskRunAttemptCounterExhaustedError;
```

DTE03-D refines ordinary stale command delivery to `current`. Therefore the two
`Stale...Error` members are not emitted merely because a caller supplied an old
run version or fence. They are invariant guards for a purported accepted commit
whose basis/fence disagrees with the already-decoded current state. This retains
DTE02's named union without contradicting the current-outcome contract.

`InvalidRunAttemptTransitionError` describes newly proposed candidate/state/
acceptance/replay/evidence/effect data. The same problem found in already stored
data is `TaskSystemRunAttemptCorruptionError` instead.

Conflict details deliberately omit completion bodies, result digests, failure
messages, and fences. Invalid acknowledgement reports only bounded generations.

### Store Error Union

```ts
interface TaskSystemRunAttemptUnavailableError {
  readonly _tag: "TaskSystemRunAttemptUnavailableError";
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason: "unavailable";
}

interface TaskSystemRunAttemptCorruptionError {
  readonly _tag: "TaskSystemRunAttemptCorruptionError";
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "aggregate_invalid"
    | "binding_reference_invalid"
    | "acceptance_invalid"
    | "completion_replay_invalid"
    | "evidence_invalid"
    | "effect_sequence_invalid";
}

interface TaskSystemRunAttemptStaleScopeAuthorityError {
  readonly _tag: "TaskSystemRunAttemptStaleScopeAuthorityError";
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly authority:
    | "epoch"
    | "storage_generation"
    | "physical_locator"
    | "deployment_binding";
}

interface TaskSystemRunAttemptTransientStoreError {
  readonly _tag: "TaskSystemRunAttemptTransientStoreError";
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "transaction_conflict"
    | "connection_unavailable"
    | "timeout"
    | "driver_failure";
  readonly cause: unknown;
}

interface TaskSystemRunAttemptTerminalStoreError {
  readonly _tag: "TaskSystemRunAttemptTerminalStoreError";
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "unsupported_integration"
    | "wrong_placement"
    | "transaction_capability_missing"
    | "identity_allocation_exhausted"
    | "fence_allocation_exhausted"
    | "version_storage_exhausted"
    | "serialization_unsupported";
  readonly cause: unknown | null;
}

type TaskSystemRunAttemptStoreErrorV1 =
  | TaskSystemRunAttemptUnavailableError
  | TaskSystemRunAttemptCorruptionError
  | TaskSystemRunAttemptStaleScopeAuthorityError
  | TaskSystemRunAttemptTransientStoreError
  | TaskSystemRunAttemptTerminalStoreError;
```

Absent and cross-scope state share the exact unavailable value and cannot be
distinguished. Foreign persistence causes appear only on transient/terminal
store adapters, are never inspected by domain policy, and must be redacted at
HTTP/log/public boundaries. These error objects are internal Effect failures,
not serializable observability events.

### Exported Lifecycle Error

```ts
type RunAttemptLifecycleErrorV1 =
  | InvalidRunAttemptCommandError
  | RunAttemptDecisionErrorV1
  | TaskSystemRunAttemptStoreErrorV1;
```

Backend authentication, tenant membership, active-revision selection, runtime
binding resolution, effect delivery, and public transport errors remain outside
this union.

## Exact Evaluation And First-Error Order

The service boundary applies this order:

1. decode the operation-specific closed command; otherwise
   `InvalidRunAttemptCommandError`;
2. obtain the already-authorized scope-bound store capability outside the
   lifecycle service;
3. validate scope epoch/generation/locator/deployment freshness;
4. load the run under that scope, mapping absent and cross-scope identically;
5. decode aggregate, binding reference, acceptance, completion replay,
   evidence, effect cursor, and persisted effect records as corruption;
6. obtain one transaction database-time snapshot and the start candidate only
   for `start_attempt`;
7. for completion, perform replay equality/conflict lookup first;
8. for other mutations, perform exact latest direct replay lookup;
9. apply DTE03-E's operation-specific current-reason order;
10. for an exact cancellation acknowledgement pair, validate request presence
    and generation before lease time;
11. evaluate the DTE03-D logical lease boundary where required;
12. apply DTE03-C policy and checked run/attempt/lease/time arithmetic;
13. construct the exact outcome, one evidence record, ordered sequenced effects,
    acceptance, optional completion replay, and next aggregate;
14. validate next-state, replay, evidence, effect-order, cursor, and commit-basis
    invariants in the store;
15. atomically persist everything or map one store failure; and
16. detach the accepted/idempotent/current receipt or inspection projection.

At steps 7 through 12, a DTE03-D current outcome short-circuits later lifecycle
checks and writes nothing. A conflict or invalid acknowledgement short-circuits
policy/effect construction. Store failure never becomes task failure or current
state. Transaction retry may re-enter the pure decision with a new coherent
input; it may not reuse a candidate or decision from the earlier attempt.

## Schema, Immutability, And Bounds

The future package owns hoisted closed Effect Schema values for every outcome,
projection, evidence, effect, persisted-effect wrapper, acceptance, replay leaf,
and serializable error detail in this receipt. Runtime-only foreign `cause`
members are not decoded from callers or persisted as domain data.

Mandatory bounds and ownership rules:

- exactly one evidence record for accepted DTE-IP01 mutations;
- zero evidence/effects for current decisions;
- two through five requested effects for accepted DTE-IP01 mutations;
- contiguous positive effect sequences with checked 64-bit storage range;
- at most 250 completion replays;
- owned copies for result digest bytes and every nested array;
- recursively immutable detached state/outcome/evidence/effect/receipt values;
- strict rejection of unknown fields and inconsistent discriminants;
- no arbitrary error message, metadata map, JSON, URL, path, SQL/driver value,
  Error, Cause, stack, or mutable foreign object in persisted domain records;
  and
- no caller-controlled property traversal after Schema decoding.

The persisted representation may normalize these values across tables. It must
reconstruct the exact domain shapes and first-failure order; a JSON column is
neither required nor forbidden by this receipt.

## Required DTE03-F Vectors And DTE-IP01 Tests

At minimum:

- every disposition/outcome compatibility row;
- every operation-specific current reason and its precedence;
- exact inspection projection for all five phases and cancellation variants;
- exact direct replay after accepted start/heartbeat/cancellation/expiry;
- completion replay after retry, later attempt, and terminal state;
- failure-message-only completion redelivery returning idempotent original data;
- conflicting completion safe error projection;
- invalid acknowledgement with no request and wrong generation;
- one evidence record and two-to-five exact effects for every accepted
  transition;
- accepted ordinary/OOM/lease-loss retry evidence and every retry-rejection
  reason, including jitter-use, delay-source, delivery-reason, and compute-
  escalation correlations;
- first versus later heartbeat event/effect difference;
- cancellation-requested failure using terminal effects without retry;
- lease recovery omitting cancellation of its currently consumed wake;
- effect sequence first allocation, contiguity, replay stability, and overflow;
- next aggregate acceptance/effect cursor agreeing with decision output;
- malformed aggregate/replay/evidence/effect mapped to corruption;
- absent and cross-scope runs producing indistinguishable unavailable errors;
- transient versus terminal store error mapping with no partial commit;
- command error redaction and store-cause boundary redaction; and
- no outcome, inspection, evidence, or event exposing removed Trigger product
  or host/persistence fields.

## Decisions Closed By DTE03-E

1. Five mutation outcomes and one inspection projection are closed unions.
2. Current results carry one bounded current-state projection and exact reason.
3. Accepted and idempotent receipts share stored acceptance data but retain
   different dispositions.
4. Direct replay has one latest slot; completion replay remains attempt-bounded.
5. Every accepted DTE-IP01 mutation produces exactly one evidence record.
6. Evidence is bounded replay evidence, not an unbounded observability history.
7. Requested effects have nine exact variants and at most five per mutation.
8. First heartbeat publishes execution observation; later heartbeats do not.
9. Lifecycle event payloads exclude diagnostic messages and arbitrary metadata.
10. Effect sequence proposal is derived from the stored cursor and becomes
    authoritative only after store validation and atomic commit.
11. Ordinary stale versions/fences remain current outcomes; named stale errors
    guard impossible accepted commit proposals only.
12. Command, decision, and store errors remain typed and preserve owner/order.
13. Inspection and lifecycle events are not a tenant-facing observability API.

## Exact Handoff To DTE03-F

DTE03-F must now turn DTE03-A through DTE03-E into canonical scenario fixtures:

- closed command inputs and expected receipt/error encodings;
- phase/cancellation/lease boundary matrices;
- exact evidence and ordered effect arrays with sequence cursors;
- Trigger differential cases where source behavior is retained;
- translated assertions where Flarex deliberately changes identity/authority;
- explicit outside-first-vertical cases; and
- executable pure-decision and Schema gates required before DTE03-G.

DTE03-F may discover a contradiction and return to the owning checkpoint. It
may not relax a race winner, add a Trigger product field, or create the package
merely to make a vector pass.

Do not create `packages/durable-task/` until DTE03-G admits the complete
lifecycle contract.

## Reopening Audit

DTE03-E does not reopen DTE01/DTE02 product or authority boundaries:

- no Trigger runtime dependency or product schema is imported;
- no service command or store method is added;
- the effect-sequence correction makes existing aggregate replay implementable
  and retains store validation/commit authority;
- no raw scope, tenant, project, environment, deployment, queue, provider,
  transaction, clock, allocator, or artifact locator enters a command;
- all outcomes/evidence/effects are private host-neutral domain values;
- run creation remains Roadmap 04's owner;
- observability delivery/read APIs remain a later roadmap; and
- waitpoints, checkpoints, pause/resume, child runs, batch, TTL, logs, traces,
  pricing, and public SDK behavior remain excluded.

## Authority And Evidence

- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`15-cancellation-heartbeat-lease-and-race-tables.md`](./15-cancellation-heartbeat-lease-and-race-tables.md)
- [`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
- [`13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
- [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md)
- [`11-final-identity-admission.md`](./11-final-identity-admission.md)
- [`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- frozen Trigger source and admitted tests at commit
  `f10bc23785e569e5d917318cf2033aabdbe96a0b`
