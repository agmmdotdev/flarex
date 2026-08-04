// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/eventBus.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import type { Brand } from "effect";

export type TaskDefinitionRevisionIdV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskDefinitionRevisionIdV1"
>;
export type TaskRunIdV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskRunIdV1"
>;
export type TaskAttemptIdV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskAttemptIdV1"
>;
export type TaskComputeProfileRefV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskComputeProfileRefV1"
>;
export type TaskFailureMessageV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskFailureMessageV1"
>;
export type TaskCancellationMessageV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskCancellationMessageV1"
>;

export type TaskAttemptNumberV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskAttemptNumberV1"
>;
export type TaskHeartbeatSequenceV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskHeartbeatSequenceV1"
>;
export type TaskDatabaseTimeMsV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskDatabaseTimeMsV1"
>;
export type TaskDurationMsV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskDurationMsV1"
>;
export type TaskExecutionDurationMsV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskExecutionDurationMsV1"
>;
export type TaskRetryJitterV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskRetryJitterV1"
>;
export type TaskMaximumAttemptsV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskMaximumAttemptsV1"
>;
export type TaskRetryFactorV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskRetryFactorV1"
>;

export type TaskExecutionFenceV1 = Brand.Branded<
  bigint,
  "FlarexDurableTask/TaskExecutionFenceV1"
>;
export type TaskRunVersionV1 = Brand.Branded<
  bigint,
  "FlarexDurableTask/TaskRunVersionV1"
>;
export type TaskLeaseVersionV1 = Brand.Branded<
  bigint,
  "FlarexDurableTask/TaskLeaseVersionV1"
>;
export type TaskCancellationGenerationV1 = Brand.Branded<
  bigint,
  "FlarexDurableTask/TaskCancellationGenerationV1"
>;
export type TaskRequestedEffectSequenceV1 = Brand.Branded<
  bigint,
  "FlarexDurableTask/TaskRequestedEffectSequenceV1"
>;

export type RunAttemptPhaseV1 =
  | "ready"
  | "attempt_granted"
  | "executing"
  | "retry_waiting"
  | "terminal";

export interface RunAttemptPolicyV1 {
  readonly version: 1;
  readonly retry: {
    readonly maxAttempts: TaskMaximumAttemptsV1;
    readonly factor: TaskRetryFactorV1;
    readonly minTimeoutInMs: TaskDurationMsV1;
    readonly maxTimeoutInMs: TaskDurationMsV1;
    readonly randomize: boolean;
  };
  readonly outOfMemory:
    | { readonly kind: "disabled" }
    | {
        readonly kind: "escalate_once";
        readonly computeProfile: TaskComputeProfileRefV1;
      };
}

export interface TaskRunAttemptBoundPolicyV1 {
  readonly runAttempt: RunAttemptPolicyV1;
  readonly maximumDurationMs: TaskDurationMsV1;
  readonly initialComputeProfile: TaskComputeProfileRefV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}

export type TaskAttemptHistoryCursorV1 =
  | { readonly kind: "none" }
  | {
      readonly kind: "issued";
      readonly lastAttemptNumber: TaskAttemptNumberV1;
    };

export type TaskLeaseHistoryCursorV1 =
  | { readonly kind: "none" }
  | {
      readonly kind: "issued";
      readonly lastLeaseVersion: TaskLeaseVersionV1;
    };

export type TaskRequestedEffectCursorV1 =
  | { readonly kind: "none" }
  | {
      readonly kind: "issued";
      readonly lastSequence: TaskRequestedEffectSequenceV1;
    };

export interface TaskCancellationReasonV1 {
  readonly code:
    | "requested"
    | "execution_cancelled"
    | "policy_cancelled";
  readonly message: TaskCancellationMessageV1 | null;
}

export interface TaskResultCommitmentV1 {
  readonly codec: "flarex.task-result.v1";
  readonly byteLength: number;
  readonly sha256: Uint8Array;
}

export type TaskRetryDirectiveV1 =
  | { readonly kind: "use_bound_policy" }
  | { readonly kind: "do_not_retry" }
  | {
      readonly kind: "override_delay";
      readonly delayMs: TaskDurationMsV1;
    };

export type TaskExecutionFailureV1 =
  | {
      readonly kind: "task_failure";
      readonly code:
        | "uncaught_exception"
        | "input_validation_failed"
        | "output_validation_failed"
        | "middleware_failed"
        | "handler_failed";
      readonly message: TaskFailureMessageV1 | null;
    }
  | {
      readonly kind: "system_failure";
      readonly code:
        | "attempt_dispatch_failed"
        | "runtime_start_failed"
        | "execution_lost"
        | "execution_aborted"
        | "provider_evicted"
        | "provider_failure"
        | "task_binding_unavailable"
        | "configuration_invalid"
        | "internal_invariant";
      readonly message: TaskFailureMessageV1 | null;
    }
  | {
      readonly kind: "resource_exhaustion";
      readonly code:
        | "out_of_memory"
        | "possible_out_of_memory"
        | "process_crashed"
        | "disk_exhausted";
      readonly message: TaskFailureMessageV1 | null;
    }
  | {
      readonly kind: "timed_out";
      readonly code: "maximum_duration_exceeded";
      readonly message: TaskFailureMessageV1 | null;
    };

export type TaskTerminalFailureClassV1 =
  | "task_failure"
  | "system_failure"
  | "resource_exhaustion"
  | "timed_out";

export interface TaskAttemptLeaseV1 {
  readonly version: TaskLeaseVersionV1;
  readonly renewedAtMs: TaskDatabaseTimeMsV1;
  readonly expiresAtMs: TaskDatabaseTimeMsV1;
}

export interface TaskCurrentAttemptV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly grantBasisRunVersion: TaskRunVersionV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly retryJitter: TaskRetryJitterV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly lease: TaskAttemptLeaseV1;
}

export type TaskAttemptHeartbeatStateV1 =
  | { readonly kind: "none_accepted" }
  | {
      readonly kind: "accepted";
      readonly highestSequence: TaskHeartbeatSequenceV1;
    };

export interface TaskCancellationNotRequestedV1 {
  readonly kind: "not_requested";
  readonly generation: TaskCancellationGenerationV1;
}

export interface TaskCancellationRequestedV1 {
  readonly kind: "requested";
  readonly generation: TaskCancellationGenerationV1;
  readonly reason: TaskCancellationReasonV1;
  readonly requestedAtMs: TaskDatabaseTimeMsV1;
}

export interface TaskCancellationResolvedV1 {
  readonly kind: "resolved";
  readonly generation: TaskCancellationGenerationV1;
  readonly reason: TaskCancellationReasonV1;
  readonly requestedAtMs: TaskDatabaseTimeMsV1;
  readonly resolvedAtMs: TaskDatabaseTimeMsV1;
  readonly resolution:
    | "without_active_attempt"
    | "acknowledged"
    | "lease_expired"
    | "superseded_by_completion";
}

export type TaskCancellationStateV1 =
  | TaskCancellationNotRequestedV1
  | TaskCancellationRequestedV1
  | TaskCancellationResolvedV1;

export interface TaskTerminalAttemptRefV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
}

export type TaskRetryCauseV1 =
  | {
      readonly kind: "failed_completion";
      readonly failure: TaskExecutionFailureV1;
    }
  | {
      readonly kind: "lease_expired_before_heartbeat";
      readonly failure: TaskExecutionFailureV1;
    }
  | {
      readonly kind: "lease_expired_after_heartbeat";
      readonly failure: TaskExecutionFailureV1;
    };

export interface TaskAcceptedRetryV1 {
  readonly previousAttempt: TaskTerminalAttemptRefV1;
  readonly acceptedAtMs: TaskDatabaseTimeMsV1;
  readonly notBeforeMs: TaskDatabaseTimeMsV1;
  readonly nextComputeProfile: TaskComputeProfileRefV1;
  readonly cause: TaskRetryCauseV1;
}

export type TaskRunReadyStateV1 =
  | {
      readonly kind: "initial";
      readonly eligibleAtMs: TaskDatabaseTimeMsV1;
    }
  | {
      readonly kind: "immediate_retry";
      readonly eligibleAtMs: TaskDatabaseTimeMsV1;
      readonly acceptedRetry: TaskAcceptedRetryV1;
    };

export type TaskRunTerminalOutcomeV1 =
  | {
      readonly kind: "succeeded";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1;
      readonly result: TaskResultCommitmentV1 | null;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: null;
      readonly cancellationGeneration: TaskCancellationGenerationV1;
      readonly reason: TaskCancellationReasonV1;
      readonly resolution: "without_active_attempt";
      readonly executionDurationMs: null;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1;
      readonly cancellationGeneration: TaskCancellationGenerationV1;
      readonly reason: TaskCancellationReasonV1;
      readonly resolution: "acknowledged";
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1;
      readonly cancellationGeneration: TaskCancellationGenerationV1;
      readonly reason: TaskCancellationReasonV1;
      readonly resolution: "lease_expired";
      readonly executionDurationMs: null;
    }
  | {
      readonly kind: "failed";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1 | null;
      readonly classification: TaskTerminalFailureClassV1;
      readonly failure: TaskExecutionFailureV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    };

export type TaskAttemptCompletionV1 =
  | {
      readonly kind: "succeeded";
      readonly result: TaskResultCommitmentV1 | null;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "failed";
      readonly failure: TaskExecutionFailureV1;
      readonly retry: TaskRetryDirectiveV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "cancellation_acknowledged";
      readonly cancellationGeneration: TaskCancellationGenerationV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    };

export interface TaskAttemptLeaseProjectionV1 {
  readonly version: TaskLeaseVersionV1;
  readonly renewedAtMs: TaskDatabaseTimeMsV1;
  readonly expiresAtMs: TaskDatabaseTimeMsV1;
}

export interface TaskActiveAttemptProjectionV1 {
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly lease: TaskAttemptLeaseProjectionV1;
}

export interface RunAttemptStateBaseV1 {
  readonly version: "flarex.run-attempt-state.v1";
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly runVersion: TaskRunVersionV1;
}

export type RunAttemptStateV1 =
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
  | (RunAttemptStateBaseV1 & (
      | {
          readonly phase: "terminal";
          readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "succeeded" | "failed" }>;
          readonly cancellation: TaskCompletionTerminalCancellationStateV1;
        }
      | {
          readonly phase: "terminal";
          readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "cancelled"; readonly resolution: "without_active_attempt" }>;
          readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "without_active_attempt" };
        }
      | {
          readonly phase: "terminal";
          readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "cancelled"; readonly resolution: "acknowledged" }>;
          readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "acknowledged" };
        }
      | {
          readonly phase: "terminal";
          readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "cancelled"; readonly resolution: "lease_expired" }>;
          readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "lease_expired" };
        }
    ));

export interface RunAttemptInspectionV1 {
  readonly version: "flarex.run-attempt-inspection.v1";
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly state: RunAttemptStateV1;
}

export interface TaskAttemptGrantV1 {
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly lease: TaskAttemptLeaseProjectionV1;
}

export type StartAttemptCurrentReasonV1 =
  | "stale_run_version"
  | "not_yet_eligible"
  | "phase_not_startable";

export type StartAttemptOutcomeV1 =
  | {
      readonly kind: "attempt_granted";
      readonly grant: TaskAttemptGrantV1;
    }
  | {
      readonly kind: "current";
      readonly reason: StartAttemptCurrentReasonV1;
      readonly state: RunAttemptStateV1;
    };

export type HeartbeatAttemptCurrentReasonV1 =
  | "phase_not_active"
  | "stale_attempt"
  | "stale_fence"
  | "lease_expired"
  | "heartbeat_not_advanced";

export type HeartbeatAttemptOutcomeV1 =
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

export type TaskRetryDeliveryV1 = "immediate" | "durable";
export type TaskRunSucceededTerminalV1 = Extract<
  TaskRunTerminalOutcomeV1,
  { readonly kind: "succeeded" }
>;
export type TaskRunCancelledTerminalV1 = Extract<
  TaskRunTerminalOutcomeV1,
  { readonly kind: "cancelled" }
>;
export type TaskRunFailedTerminalV1 = Extract<
  TaskRunTerminalOutcomeV1,
  { readonly kind: "failed" }
>;
export type TaskRunAttemptFailedTerminalV1 = TaskRunFailedTerminalV1 & {
  readonly attempt: TaskTerminalAttemptRefV1;
};
export type TaskRunCancelledWithoutAttemptTerminalV1 =
  TaskRunCancelledTerminalV1 & {
    readonly attempt: null;
    readonly resolution: "without_active_attempt";
    readonly executionDurationMs: null;
  };
export type TaskRunAcknowledgedCancellationTerminalV1 =
  TaskRunCancelledTerminalV1 & {
    readonly attempt: TaskTerminalAttemptRefV1;
    readonly resolution: "acknowledged";
  };
export type TaskRunLeaseExpiredCancellationTerminalV1 =
  TaskRunCancelledTerminalV1 & {
    readonly attempt: TaskTerminalAttemptRefV1;
    readonly resolution: "lease_expired";
    readonly executionDurationMs: null;
  };
export type TaskCompletionTerminalCancellationStateV1 =
  | TaskCancellationNotRequestedV1
  | (TaskCancellationResolvedV1 & {
      readonly resolution: "superseded_by_completion";
    });

export type CompleteAttemptCurrentReasonV1 =
  | "phase_not_active"
  | "stale_attempt"
  | "stale_fence"
  | "lease_expired";

export type CompleteAttemptOutcomeV1 =
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

export type RequestCancellationCurrentReasonV1 =
  | "already_requested"
  | "already_terminal";

export type RequestCancellationOutcomeV1 =
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

export type HandleLeaseExpiryCurrentReasonV1 =
  | "phase_not_active"
  | "stale_attempt"
  | "stale_fence"
  | "stale_lease_version"
  | "lease_not_expired";

export type HandleLeaseExpiryOutcomeV1 =
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

export interface TaskFailurePolicyDecisionEvidenceV1 {
  readonly failure: TaskExecutionFailureV1;
  readonly currentAttemptNumber: TaskAttemptNumberV1;
  readonly maximumAttempts: TaskMaximumAttemptsV1;
  readonly directive: {
    readonly source: "completion" | "synthesized_bound_policy";
    readonly value: TaskRetryDirectiveV1;
  };
  readonly storedRetryJitter: TaskRetryJitterV1;
  readonly jitterUsed: boolean;
  readonly decision:
    | {
        readonly kind: "retry_accepted";
        readonly eligibility: "ordinary" | "oom_escalation" | "lease_loss";
        readonly delaySource: "bound_policy" | "override_delay";
        readonly delayMs: TaskDurationMsV1;
        readonly notBeforeMs: TaskDatabaseTimeMsV1;
        readonly delivery: {
          readonly kind: TaskRetryDeliveryV1;
          readonly reason:
            | "below_immediate_threshold"
            | "failure_code_forced_durable"
            | "at_or_above_immediate_threshold"
            | "oom_forced_durable"
            | "lease_loss_forced_durable";
        };
        readonly computeEscalation: {
          readonly previous: TaskComputeProfileRefV1;
          readonly next: TaskComputeProfileRefV1;
        } | null;
      }
    | {
        readonly kind: "retry_rejected";
        readonly reason:
          | "cancellation_requested"
          | "directive_do_not_retry"
          | "attempt_limit_reached"
          | "failure_not_retryable"
          | "oom_escalation_disabled"
          | "oom_escalation_already_applied";
        readonly terminalClassification: TaskTerminalFailureClassV1;
      };
}

export type TaskLifecycleEventProjectionV1 =
  | { readonly kind: "attempt_granted"; readonly attemptNumber: TaskAttemptNumberV1 }
  | { readonly kind: "execution_observed"; readonly attemptNumber: TaskAttemptNumberV1 }
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
        | { readonly source: "failed_completion"; readonly delivery: TaskRetryDeliveryV1 }
        | { readonly source: "lease_expiry"; readonly delivery: "durable" };
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
        | { readonly attemptNumber: null; readonly resolution: "without_active_attempt" }
        | {
            readonly attemptNumber: TaskAttemptNumberV1;
            readonly resolution: "acknowledged" | "lease_expired";
          };
    }
  | {
      readonly kind: "run_failed";
      readonly attemptNumber: TaskAttemptNumberV1 | null;
      readonly failure:
        | { readonly kind: "task_failure"; readonly code: Extract<TaskExecutionFailureV1, { readonly kind: "task_failure" }>["code"] }
        | { readonly kind: "system_failure"; readonly code: Extract<TaskExecutionFailureV1, { readonly kind: "system_failure" }>["code"] }
        | { readonly kind: "resource_exhaustion"; readonly code: Extract<TaskExecutionFailureV1, { readonly kind: "resource_exhaustion" }>["code"] }
        | { readonly kind: "timed_out"; readonly code: Extract<TaskExecutionFailureV1, { readonly kind: "timed_out" }>["code"] };
    };

export interface TaskRequestedEffectBaseV1 {
  readonly version: "flarex.task-requested-effect.v1";
  readonly runId: TaskRunIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
}

export type TaskRequestedEffectV1 = TaskRequestedEffectBaseV1 &
  (
    | {
        readonly kind: "dispatch_attempt";
        readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly leaseVersion: TaskLeaseVersionV1;
        readonly computeProfile: TaskComputeProfileRefV1;
      }
    | {
        readonly kind: "continue_retry" | "wake_retry";
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
    | { readonly kind: "notify_current_state" }
    | {
        readonly kind: "cancel_obsolete_lease_wake";
        readonly attemptId: TaskAttemptIdV1;
        readonly executionFence: TaskExecutionFenceV1;
        readonly obsoleteLeaseVersion: TaskLeaseVersionV1;
      }
  );

export interface PersistedTaskRequestedEffectV1 {
  readonly sequence: TaskRequestedEffectSequenceV1;
  readonly effect: TaskRequestedEffectV1;
}

export interface TaskRunAttemptEvidenceBaseV1 {
  readonly version: "flarex.task-run-attempt-evidence.v1";
  readonly runId: TaskRunIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly recordedAtMs: TaskDatabaseTimeMsV1;
  readonly resultingPhase: RunAttemptPhaseV1;
}

export type TaskRunAttemptEvidenceV1 = TaskRunAttemptEvidenceBaseV1 &
  (
    | { readonly kind: "attempt_granted"; readonly fromPhase: "ready" | "retry_waiting"; readonly grant: TaskAttemptGrantV1 }
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
        readonly completion: Extract<TaskAttemptCompletionV1, { readonly kind: "succeeded" }>;
        readonly outcome: Extract<CompleteAttemptOutcomeV1, { readonly kind: "terminal_succeeded" }>;
      }
    | {
        readonly kind: "completion_failed";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly completion: Extract<TaskAttemptCompletionV1, { readonly kind: "failed" }>;
        readonly policy: TaskFailurePolicyDecisionEvidenceV1;
        readonly outcome: Extract<CompleteAttemptOutcomeV1, { readonly kind: "retry_scheduled" | "terminal_failed" }>;
      }
    | {
        readonly kind: "completion_cancellation_acknowledged";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly completion: Extract<TaskAttemptCompletionV1, { readonly kind: "cancellation_acknowledged" }>;
        readonly outcome: Extract<CompleteAttemptOutcomeV1, { readonly kind: "terminal_cancelled" }>;
      }
    | {
        readonly kind: "cancellation_requested";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly cancellation: TaskCancellationRequestedV1;
        readonly outcome: Extract<RequestCancellationOutcomeV1, { readonly kind: "cancellation_requested" }>;
      }
    | {
        readonly kind: "cancellation_resolved_without_attempt";
        readonly attempt: null;
        readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "without_active_attempt" };
        readonly outcome: Extract<RequestCancellationOutcomeV1, { readonly kind: "terminal_cancelled" }>;
      }
    | {
        readonly kind: "lease_expiry_recovered";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly expiredLeaseVersion: TaskLeaseVersionV1;
        readonly sourcePhase: "attempt_granted" | "executing";
        readonly policy: TaskFailurePolicyDecisionEvidenceV1;
        readonly outcome: Extract<HandleLeaseExpiryOutcomeV1, { readonly kind: "retry_scheduled" | "terminal_failed" }>;
      }
    | {
        readonly kind: "lease_expiry_cancelled";
        readonly attempt: TaskTerminalAttemptRefV1;
        readonly expiredLeaseVersion: TaskLeaseVersionV1;
        readonly sourcePhase: "attempt_granted" | "executing";
        readonly outcome: Extract<HandleLeaseExpiryOutcomeV1, { readonly kind: "terminal_cancelled" }>;
      }
  );

export interface TaskRunAttemptAcceptedReceiptV1<Outcome> {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly resultingPhase: RunAttemptPhaseV1;
  readonly outcome: Outcome;
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly requestedEffects: readonly PersistedTaskRequestedEffectV1[];
}

export type TaskRunAttemptDirectCommandIdentityV1 =
  | { readonly kind: "start_attempt"; readonly expectedRunVersion: TaskRunVersionV1 }
  | {
      readonly kind: "heartbeat_attempt";
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly heartbeatSequence: TaskHeartbeatSequenceV1;
    }
  | { readonly kind: "request_cancellation"; readonly reason: TaskCancellationReasonV1 }
  | {
      readonly kind: "handle_lease_expiry";
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly expectedLeaseVersion: TaskLeaseVersionV1;
    };

export type AcceptedStartAttemptOutcomeV1 = Extract<StartAttemptOutcomeV1, { readonly kind: "attempt_granted" }>;
export type AcceptedHeartbeatAttemptOutcomeV1 = Extract<HeartbeatAttemptOutcomeV1, { readonly kind: "lease_renewed" }>;
export type AcceptedCompleteAttemptOutcomeV1 = Exclude<CompleteAttemptOutcomeV1, { readonly kind: "current" }>;
export type AcceptedRequestCancellationOutcomeV1 = Exclude<RequestCancellationOutcomeV1, { readonly kind: "current" }>;
export type AcceptedHandleLeaseExpiryOutcomeV1 = Exclude<HandleLeaseExpiryOutcomeV1, { readonly kind: "current" }>;

export type TaskRunAttemptMutationAcceptanceV1 =
  | {
      readonly kind: "start_attempt";
      readonly command: Extract<TaskRunAttemptDirectCommandIdentityV1, { readonly kind: "start_attempt" }>;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<AcceptedStartAttemptOutcomeV1>;
    }
  | {
      readonly kind: "heartbeat_attempt";
      readonly command: Extract<TaskRunAttemptDirectCommandIdentityV1, { readonly kind: "heartbeat_attempt" }>;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<AcceptedHeartbeatAttemptOutcomeV1>;
    }
  | {
      readonly kind: "complete_attempt";
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<AcceptedCompleteAttemptOutcomeV1>;
    }
  | {
      readonly kind: "request_cancellation";
      readonly command: Extract<TaskRunAttemptDirectCommandIdentityV1, { readonly kind: "request_cancellation" }>;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<AcceptedRequestCancellationOutcomeV1>;
    }
  | {
      readonly kind: "handle_lease_expiry";
      readonly command: Extract<TaskRunAttemptDirectCommandIdentityV1, { readonly kind: "handle_lease_expiry" }>;
      readonly accepted: TaskRunAttemptAcceptedReceiptV1<AcceptedHandleLeaseExpiryOutcomeV1>;
    };

export interface TaskAttemptCompletionReplayV1 {
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly completion: TaskAttemptCompletionV1;
  readonly accepted: TaskRunAttemptAcceptedReceiptV1<AcceptedCompleteAttemptOutcomeV1>;
}

function taskResultDigestBytesEqualV1(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Canonical equality for completion replay identity. Failure messages are
 * diagnostic only and deliberately do not distinguish an accepted completion
 * from its retry.
 */
export function areTaskAttemptCompletionsReplayEqualV1(
  left: TaskAttemptCompletionV1,
  right: TaskAttemptCompletionV1,
): boolean {
  if (left.kind !== right.kind || left.executionDurationMs !== right.executionDurationMs) return false;
  if (left.kind === "succeeded" && right.kind === "succeeded") {
    if (left.result === null || right.result === null) return left.result === right.result;
    return left.result.codec === right.result.codec &&
      left.result.byteLength === right.result.byteLength &&
      taskResultDigestBytesEqualV1(left.result.sha256, right.result.sha256);
  }
  if (left.kind === "failed" && right.kind === "failed") {
    const directivesEqual = left.retry.kind === right.retry.kind &&
      (left.retry.kind !== "override_delay" ||
        (right.retry.kind === "override_delay" && left.retry.delayMs === right.retry.delayMs));
    return directivesEqual && left.failure.kind === right.failure.kind && left.failure.code === right.failure.code;
  }
  return left.kind === "cancellation_acknowledged" &&
    right.kind === "cancellation_acknowledged" &&
    left.cancellationGeneration === right.cancellationGeneration;
}

export interface TaskRunAttemptAggregateBaseV1 {
  readonly version: "flarex.task-run-attempt-aggregate.v1";
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly boundPolicy: TaskRunAttemptBoundPolicyV1;
  readonly attemptHistory: TaskAttemptHistoryCursorV1;
  readonly leaseHistory: TaskLeaseHistoryCursorV1;
  readonly lastLifecycleAcceptance: TaskRunAttemptMutationAcceptanceV1 | null;
  readonly completionReplays: readonly TaskAttemptCompletionReplayV1[];
  readonly requestedEffectCursor: TaskRequestedEffectCursorV1;
}

export interface TaskRunAttemptReadyAggregateV1 extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "ready";
  readonly ready: TaskRunReadyStateV1;
  readonly cancellation: TaskCancellationNotRequestedV1;
}
export interface TaskRunAttemptGrantedAggregateV1 extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "attempt_granted";
  readonly currentAttempt: TaskCurrentAttemptV1;
  readonly heartbeat: { readonly kind: "none_accepted" };
  readonly cancellation: TaskCancellationNotRequestedV1 | TaskCancellationRequestedV1;
}
export interface TaskRunAttemptExecutingAggregateV1 extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "executing";
  readonly currentAttempt: TaskCurrentAttemptV1;
  readonly heartbeat: { readonly kind: "accepted"; readonly highestSequence: TaskHeartbeatSequenceV1 };
  readonly cancellation: TaskCancellationNotRequestedV1 | TaskCancellationRequestedV1;
}
export interface TaskRunAttemptRetryWaitingAggregateV1 extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "retry_waiting";
  readonly retry: TaskAcceptedRetryV1;
  readonly cancellation: TaskCancellationNotRequestedV1;
}
export type TaskRunAttemptTerminalAggregateV1 = TaskRunAttemptAggregateBaseV1 & (
  | {
      readonly phase: "terminal";
      readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "succeeded" | "failed" }>;
      readonly cancellation: TaskCompletionTerminalCancellationStateV1;
    }
  | {
      readonly phase: "terminal";
      readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "cancelled"; readonly resolution: "without_active_attempt" }>;
      readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "without_active_attempt" };
    }
  | {
      readonly phase: "terminal";
      readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "cancelled"; readonly resolution: "acknowledged" }>;
      readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "acknowledged" };
    }
  | {
      readonly phase: "terminal";
      readonly terminal: Extract<TaskRunTerminalOutcomeV1, { readonly kind: "cancelled"; readonly resolution: "lease_expired" }>;
      readonly cancellation: TaskCancellationResolvedV1 & { readonly resolution: "lease_expired" };
    }
);
export type TaskRunAttemptAggregateV1 =
  | TaskRunAttemptReadyAggregateV1
  | TaskRunAttemptGrantedAggregateV1
  | TaskRunAttemptExecutingAggregateV1
  | TaskRunAttemptRetryWaitingAggregateV1
  | TaskRunAttemptTerminalAggregateV1;

export interface StartAttemptCommandV1 {
  readonly type: "start_attempt";
  readonly runId: TaskRunIdV1;
  readonly expectedRunVersion: TaskRunVersionV1;
  readonly retryJitter: TaskRetryJitterV1;
}
export interface HeartbeatAttemptCommandV1 {
  readonly type: "heartbeat_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly heartbeatSequence: TaskHeartbeatSequenceV1;
}
export interface CompleteAttemptCommandV1 {
  readonly type: "complete_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly completion: TaskAttemptCompletionV1;
}
export interface RequestCancellationCommandV1 {
  readonly type: "request_cancellation";
  readonly runId: TaskRunIdV1;
  readonly reason: TaskCancellationReasonV1;
}
export interface HandleLeaseExpiryCommandV1 {
  readonly type: "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly expectedLeaseVersion: TaskLeaseVersionV1;
}
export interface InspectCurrentAttemptCommandV1 {
  readonly type: "inspect_current_attempt";
  readonly runId: TaskRunIdV1;
}
export type RunAttemptCommandV1 =
  | StartAttemptCommandV1
  | HeartbeatAttemptCommandV1
  | CompleteAttemptCommandV1
  | RequestCancellationCommandV1
  | HandleLeaseExpiryCommandV1
  | InspectCurrentAttemptCommandV1;

export interface RunAttemptServiceReceiptV1<Outcome> {
  readonly disposition: "accepted" | "idempotent" | "current";
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly outcome: Outcome;
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly requestedEffects: readonly PersistedTaskRequestedEffectV1[];
}

export interface TaskAttemptGrantCandidateV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
}

export interface TaskSystemRunAttemptDecisionInputV1 {
  readonly databaseNowMs: TaskDatabaseTimeMsV1;
  readonly current: TaskRunAttemptAggregateV1;
  readonly attemptGrantCandidate: TaskAttemptGrantCandidateV1 | null;
}

export type TaskRunAttemptDecisionV1<Outcome> =
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
      readonly requestedEffects: readonly PersistedTaskRequestedEffectV1[];
      readonly outcome: Outcome;
    };

export type RunAttemptOperationV1 =
  | "start_attempt"
  | "heartbeat_attempt"
  | "complete_attempt"
  | "request_cancellation"
  | "handle_lease_expiry"
  | "inspect_current_attempt";
export type RunAttemptMutationOperationV1 = Exclude<
  RunAttemptOperationV1,
  "inspect_current_attempt"
>;

export interface TaskSystemRunAttemptInspectionRequestV1 {
  readonly operation: "inspect_current_attempt";
  readonly runId: TaskRunIdV1;
}

export interface TaskSystemRunAttemptInspectionSnapshotV1 {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly current: TaskRunAttemptAggregateV1;
}

export type TaskSystemRunAttemptTransactionReceiptV1<Outcome> =
  RunAttemptServiceReceiptV1<Outcome>;

export interface RunAttemptLifecycleConfigurationV1 {
  readonly version: 1;
  readonly maximumCompletionReplays: 250;
  readonly maximumRequestedEffectsPerMutation: 5;
}

export const RUN_ATTEMPT_LIFECYCLE_CONFIGURATION_V1 = Object.freeze({
  version: 1,
  maximumCompletionReplays: 250,
  maximumRequestedEffectsPerMutation: 5,
} satisfies RunAttemptLifecycleConfigurationV1);

function projectAttempt(attempt: TaskCurrentAttemptV1): TaskTerminalAttemptRefV1 {
  return {
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    executionFence: attempt.executionFence,
  };
}

function projectActiveAttempt(
  attempt: TaskCurrentAttemptV1,
): TaskActiveAttemptProjectionV1 {
  return {
    attempt: projectAttempt(attempt),
    computeProfile: attempt.computeProfile,
    grantedAtMs: attempt.grantedAtMs,
    lease: { ...attempt.lease },
  };
}

/**
 * Own and recursively freeze a projection built only from the decoded
 * run-attempt domain. Typed-array leaves are detached by structuredClone but
 * cannot themselves be frozen when non-empty; their containing records are
 * frozen and no caller-owned byte view is retained.
 */
function snapshotRunAttemptDomainValueV1<T>(value: T): T {
  const snapshot = structuredClone(value);
  freezeRunAttemptDomainValueV1(snapshot);
  return snapshot;
}

function freezeRunAttemptDomainValueV1(value: unknown): void {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) freezeRunAttemptDomainValueV1(child);
  Object.freeze(value);
}

export function snapshotTaskRunAttemptAggregateV1(
  aggregate: TaskRunAttemptAggregateV1,
): TaskRunAttemptAggregateV1 {
  return snapshotRunAttemptDomainValueV1(aggregate);
}

function snapshotRunAttemptProjectionV1<T extends RunAttemptStateV1>(value: T): T {
  return snapshotRunAttemptDomainValueV1(value);
}

export function projectRunAttemptStateV1(
  aggregate: TaskRunAttemptAggregateV1,
): RunAttemptStateV1 {
  const base = {
    version: "flarex.run-attempt-state.v1" as const,
    runId: aggregate.runId,
    taskDefinitionRevisionId: aggregate.taskDefinitionRevisionId,
    runVersion: aggregate.runVersion,
  };

  switch (aggregate.phase) {
    case "ready":
      return snapshotRunAttemptProjectionV1({ ...base, phase: "ready", ready: aggregate.ready, cancellation: aggregate.cancellation });
    case "attempt_granted":
      return snapshotRunAttemptProjectionV1({
        ...base,
        phase: "attempt_granted",
        currentAttempt: projectActiveAttempt(aggregate.currentAttempt),
        heartbeat: aggregate.heartbeat,
        cancellation: aggregate.cancellation,
      });
    case "executing":
      return snapshotRunAttemptProjectionV1({
        ...base,
        phase: "executing",
        currentAttempt: projectActiveAttempt(aggregate.currentAttempt),
        heartbeat: aggregate.heartbeat,
        cancellation: aggregate.cancellation,
      });
    case "retry_waiting":
      return snapshotRunAttemptProjectionV1({ ...base, phase: "retry_waiting", retry: aggregate.retry, cancellation: aggregate.cancellation });
    case "terminal": {
      const { terminal, cancellation } = aggregate;
      if (terminal.kind === "succeeded" || terminal.kind === "failed") {
        if (cancellation.kind === "resolved" && cancellation.resolution !== "superseded_by_completion") {
          throw new Error("Invalid terminal completion cancellation state");
        }
        return snapshotRunAttemptProjectionV1({ ...base, phase: "terminal", terminal, cancellation });
      }
      if (cancellation.kind !== "resolved" || cancellation.resolution !== terminal.resolution) {
        throw new Error("Invalid terminal cancellation resolution state");
      }
      switch (terminal.resolution) {
        case "without_active_attempt":
          if (cancellation.resolution !== "without_active_attempt") throw new Error("Invalid cancellation resolution");
          return snapshotRunAttemptProjectionV1({ ...base, phase: "terminal", terminal, cancellation });
        case "acknowledged":
          if (cancellation.resolution !== "acknowledged") throw new Error("Invalid cancellation resolution");
          return snapshotRunAttemptProjectionV1({ ...base, phase: "terminal", terminal, cancellation });
        case "lease_expired":
          if (cancellation.resolution !== "lease_expired") throw new Error("Invalid cancellation resolution");
          return snapshotRunAttemptProjectionV1({ ...base, phase: "terminal", terminal, cancellation });
      }
    }
  }
}

export function projectRunAttemptInspectionV1(
  observedAtMs: TaskDatabaseTimeMsV1,
  aggregate: TaskRunAttemptAggregateV1,
): RunAttemptInspectionV1 {
  return Object.freeze({
    version: "flarex.run-attempt-inspection.v1",
    observedAtMs,
    state: projectRunAttemptStateV1(aggregate),
  });
}
