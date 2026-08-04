// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Brand, Result } from "effect";
import { TaskRunAttemptPolicyError } from "./Errors.js";
import type {
  RunAttemptMutationOperationV1,
  TaskComputeProfileRefV1,
  TaskDatabaseTimeMsV1,
  TaskDurationMsV1,
  TaskExecutionFailureV1,
  TaskFailurePolicyDecisionEvidenceV1,
  TaskRetryDeliveryV1,
  TaskRetryDirectiveV1,
  TaskRunAttemptBoundPolicyV1,
  TaskRunAttemptAggregateV1,
  TaskRunIdV1,
  TaskTerminalFailureClassV1,
  TaskCurrentAttemptV1,
} from "./Model.js";

const durationMs = Brand.nominal<TaskDurationMsV1>();
const databaseTimeMs = Brand.nominal<TaskDatabaseTimeMsV1>();

export function isRunAttemptExecutingV1(aggregate: TaskRunAttemptAggregateV1): boolean {
  return aggregate.phase === "executing";
}

export function isRunAttemptPendingExecutingV1(aggregate: TaskRunAttemptAggregateV1): boolean {
  return aggregate.phase === "attempt_granted";
}

export function isRunAttemptFinishedOrPendingFinishedV1(
  aggregate: TaskRunAttemptAggregateV1,
): boolean {
  return aggregate.phase === "terminal" ||
    ((aggregate.phase === "attempt_granted" || aggregate.phase === "executing") &&
      aggregate.cancellation.kind === "requested");
}

export function isRunAttemptInitialV1(aggregate: TaskRunAttemptAggregateV1): boolean {
  return aggregate.phase === "ready" || aggregate.phase === "retry_waiting";
}

const DURABLE_FAILURE_CODES = new Set<TaskExecutionFailureV1["code"]>([
  "attempt_dispatch_failed",
  "runtime_start_failed",
  "execution_lost",
  "execution_aborted",
  "provider_evicted",
  "provider_failure",
  "process_crashed",
]);

const NEVER_RETRY_FAILURE_CODES = new Set<TaskExecutionFailureV1["code"]>([
  "task_binding_unavailable",
  "configuration_invalid",
  "internal_invariant",
  "disk_exhausted",
  "maximum_duration_exceeded",
]);

export interface FailurePolicyInputV1 {
  readonly operation: "complete_attempt" | "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly databaseNowMs: TaskDatabaseTimeMsV1;
  readonly boundPolicy: TaskRunAttemptBoundPolicyV1;
  readonly currentAttempt: TaskCurrentAttemptV1;
  readonly failure: TaskExecutionFailureV1;
  readonly directive: TaskRetryDirectiveV1;
  readonly directiveSource: "completion" | "synthesized_bound_policy";
  readonly cancellationRequested: boolean;
  readonly leaseExpiry: boolean;
}

export type FailurePolicyDecisionV1 =
  | {
      readonly kind: "retry";
      readonly delayMs: TaskDurationMsV1;
      readonly notBeforeMs: TaskDatabaseTimeMsV1;
      readonly delivery: TaskRetryDeliveryV1;
      readonly nextComputeProfile: TaskComputeProfileRefV1;
      readonly evidence: TaskFailurePolicyDecisionEvidenceV1;
    }
  | {
      readonly kind: "terminal";
      readonly classification: TaskTerminalFailureClassV1;
      readonly evidence: TaskFailurePolicyDecisionEvidenceV1;
    };

export function classifyTerminalFailureV1(
  failure: TaskExecutionFailureV1,
): TaskTerminalFailureClassV1 {
  return failure.kind;
}

function policyError(
  input: Pick<FailurePolicyInputV1, "operation" | "runId">,
  reason: TaskRunAttemptPolicyError["reason"],
): TaskRunAttemptPolicyError {
  return new TaskRunAttemptPolicyError({
    operation: input.operation,
    runId: input.runId,
    reason,
  });
}

export function validateBoundPolicyV1(
  operation: Exclude<RunAttemptMutationOperationV1, "request_cancellation">,
  runId: TaskRunIdV1,
  policy: TaskRunAttemptBoundPolicyV1,
): Result.Result<void, TaskRunAttemptPolicyError> {
  const retry = policy.runAttempt.retry;
  if (
    policy.runAttempt.version !== 1 ||
    !Number.isSafeInteger(retry.maxAttempts) ||
    retry.maxAttempts < 1 ||
    retry.maxAttempts > 250 ||
    !Number.isFinite(retry.factor) ||
    retry.factor < 1 ||
    !Number.isSafeInteger(retry.minTimeoutInMs) ||
    retry.minTimeoutInMs < 0 ||
    !Number.isSafeInteger(retry.maxTimeoutInMs) ||
    retry.maxTimeoutInMs < retry.minTimeoutInMs ||
    !Number.isSafeInteger(policy.maximumDurationMs) ||
    policy.maximumDurationMs <= 0 ||
    !Number.isSafeInteger(policy.leaseDurationMs) ||
    policy.leaseDurationMs <= 0 ||
    !Number.isSafeInteger(policy.immediateRetryThresholdMs) ||
    policy.immediateRetryThresholdMs < 0
  ) {
    return Result.fail(new TaskRunAttemptPolicyError({
      operation,
      runId,
      reason: "invalid_bound_policy",
    }));
  }
  if (
    policy.runAttempt.outOfMemory.kind === "escalate_once" &&
    policy.runAttempt.outOfMemory.computeProfile.length === 0
  ) {
    return Result.fail(new TaskRunAttemptPolicyError({
      operation,
      runId,
      reason: "compute_escalation_invalid",
    }));
  }
  return Result.succeed(undefined);
}

export function calculateBoundRetryDelayV1(
  input: Pick<FailurePolicyInputV1, "operation" | "runId" | "boundPolicy" | "currentAttempt">,
): Result.Result<TaskDurationMsV1, TaskRunAttemptPolicyError> {
  const retry = input.boundPolicy.runAttempt.retry;
  const minimum = retry.minTimeoutInMs;
  const maximum = retry.maxTimeoutInMs;
  if (minimum === 0 || maximum === 0) return Result.succeed(durationMs(0));

  const exponent = input.currentAttempt.attemptNumber - 1;
  const multiplier = retry.randomize
    ? 1 + input.currentAttempt.retryJitter
    : 1;
  const saturationBase = maximum / multiplier;
  let value: number = minimum;
  for (let step = 0; step < exponent; step += 1) {
    if (value >= saturationBase / retry.factor) {
      return Result.succeed(maximum);
    }
    value *= retry.factor;
  }
  const rounded = Math.round(Math.min(maximum, value * multiplier));
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    return Result.fail(policyError(input, "retry_delay_overflow"));
  }
  return Result.succeed(durationMs(rounded));
}

function terminalDecision(
  input: FailurePolicyInputV1,
  reason: Extract<
    TaskFailurePolicyDecisionEvidenceV1["decision"],
    { readonly kind: "retry_rejected" }
  >["reason"],
): FailurePolicyDecisionV1 {
  const classification = classifyTerminalFailureV1(input.failure);
  return {
    kind: "terminal",
    classification,
    evidence: {
      failure: input.failure,
      currentAttemptNumber: input.currentAttempt.attemptNumber,
      maximumAttempts: input.boundPolicy.runAttempt.retry.maxAttempts,
      directive: { source: input.directiveSource, value: input.directive },
      storedRetryJitter: input.currentAttempt.retryJitter,
      jitterUsed: false,
      decision: { kind: "retry_rejected", reason, terminalClassification: classification },
    },
  };
}

function retryDelay(
  input: FailurePolicyInputV1,
): Result.Result<
  { readonly delayMs: TaskDurationMsV1; readonly delaySource: "bound_policy" | "override_delay" },
  TaskRunAttemptPolicyError
> {
  if (input.directive.kind === "override_delay") {
    return Result.succeed({ delayMs: input.directive.delayMs, delaySource: "override_delay" });
  }
  return Result.map(calculateBoundRetryDelayV1(input), (delayMs) => ({
    delayMs,
    delaySource: "bound_policy" as const,
  }));
}

export function decideFailurePolicyV1(
  input: FailurePolicyInputV1,
): Result.Result<FailurePolicyDecisionV1, TaskRunAttemptPolicyError> {
  if (input.cancellationRequested) {
    return Result.succeed(terminalDecision(input, "cancellation_requested"));
  }
  if (input.directive.kind === "do_not_retry") {
    return Result.succeed(terminalDecision(input, "directive_do_not_retry"));
  }
  if (input.currentAttempt.attemptNumber >= input.boundPolicy.runAttempt.retry.maxAttempts) {
    return Result.succeed(terminalDecision(input, "attempt_limit_reached"));
  }

  const isOom = input.failure.code === "out_of_memory" || input.failure.code === "possible_out_of_memory";
  let eligibility: "ordinary" | "oom_escalation" | "lease_loss";
  let nextComputeProfile = input.currentAttempt.computeProfile;
  let forcedReason:
    | "failure_code_forced_durable"
    | "oom_forced_durable"
    | "lease_loss_forced_durable"
    | null = null;

  if (isOom) {
    const oom = input.boundPolicy.runAttempt.outOfMemory;
    if (oom.kind === "disabled") {
      return Result.succeed(terminalDecision(input, "oom_escalation_disabled"));
    }
    if (oom.computeProfile === input.currentAttempt.computeProfile) {
      return Result.succeed(terminalDecision(input, "oom_escalation_already_applied"));
    }
    eligibility = "oom_escalation";
    nextComputeProfile = oom.computeProfile;
    forcedReason = "oom_forced_durable";
  } else if (NEVER_RETRY_FAILURE_CODES.has(input.failure.code)) {
    return Result.succeed(terminalDecision(input, "failure_not_retryable"));
  } else {
    eligibility = input.leaseExpiry ? "lease_loss" : "ordinary";
    forcedReason = input.leaseExpiry
      ? "lease_loss_forced_durable"
      : DURABLE_FAILURE_CODES.has(input.failure.code)
        ? "failure_code_forced_durable"
        : null;
  }

  return Result.flatMap(retryDelay(input), ({ delayMs, delaySource }) => {
    const rawNotBefore = input.databaseNowMs + delayMs;
    if (!Number.isSafeInteger(rawNotBefore) || rawNotBefore < 0) {
      return Result.fail(policyError(input, "eligibility_time_overflow"));
    }
    const notBeforeMs = databaseTimeMs(rawNotBefore);
    const delivery: TaskRetryDeliveryV1 = forcedReason !== null ||
      delayMs >= input.boundPolicy.immediateRetryThresholdMs
      ? "durable"
      : "immediate";
    const deliveryReason = forcedReason ??
      (delivery === "immediate"
        ? "below_immediate_threshold"
        : "at_or_above_immediate_threshold");
    const jitterUsed = delaySource === "bound_policy" && input.boundPolicy.runAttempt.retry.randomize;
    return Result.succeed({
      kind: "retry",
      delayMs,
      notBeforeMs,
      delivery,
      nextComputeProfile,
      evidence: {
        failure: input.failure,
        currentAttemptNumber: input.currentAttempt.attemptNumber,
        maximumAttempts: input.boundPolicy.runAttempt.retry.maxAttempts,
        directive: { source: input.directiveSource, value: input.directive },
        storedRetryJitter: input.currentAttempt.retryJitter,
        jitterUsed,
        decision: {
          kind: "retry_accepted",
          eligibility,
          delaySource,
          delayMs,
          notBeforeMs,
          delivery: { kind: delivery, reason: deliveryReason },
          computeEscalation: nextComputeProfile === input.currentAttempt.computeProfile
            ? null
            : { previous: input.currentAttempt.computeProfile, next: nextComputeProfile },
        },
      },
    });
  });
}
