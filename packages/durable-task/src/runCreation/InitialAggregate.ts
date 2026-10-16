import { decodeTrustedWorkflowTaskRunAttemptAggregate, encodeTrustedWorkflowTaskRunAttemptAggregate } from "../runAttempt/Schema.js";
import type { CurrentTaskRunAttemptAggregate, TaskRunIdV1, TaskDatabaseTimeMsV1 } from "../runAttempt/Model.js";
import type { TrustedWorkflowBindingSha256 } from "./Model.js";
import { Brand, Result } from "effect";

import type {
  TaskCancellationGenerationV1,
  ApplicationTaskRunAttemptAggregateV1,
  TaskRunAttemptAggregateV1,
  TaskRunAttemptBoundPolicyV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";
import {
  decodeApplicationTaskRunAttemptAggregateV1,
  decodeTaskRunAttemptAggregateV1,
  encodeApplicationTaskRunAttemptAggregateV1,
  encodeTaskRunAttemptAggregateV1,
} from "../runAttempt/Schema.js";
import { InvalidTaskRunInitialAggregateError } from "./Errors.js";
import type {
  ApplicationTaskRunCreationInitialAggregateInputV1,
  TaskRunCreationInitialAggregateInputV1,
} from "./Model.js";

const runVersion = Brand.nominal<TaskRunVersionV1>();
const cancellationGeneration = Brand.nominal<TaskCancellationGenerationV1>();

/** Constructs and owns the sole Roadmap 04 legal initial lifecycle state. */
export function makeTaskRunCreationInitialAggregateV1(
  input: TaskRunCreationInitialAggregateInputV1,
): Result.Result<
  TaskRunAttemptAggregateV1,
  InvalidTaskRunInitialAggregateError
> {
  const candidate: TaskRunAttemptAggregateV1 = {
    ...initialFields(input), taskDefinitionRevisionId: input.taskDefinitionRevisionId,
  };
  return Result.gen(function* () {
    const encoded = yield* encodeTaskRunAttemptAggregateV1(candidate);
    return yield* decodeTaskRunAttemptAggregateV1(encoded);
  }).pipe(Result.mapError((cause) =>
    new InvalidTaskRunInitialAggregateError({
      operation: "make_initial_aggregate",
      reason: "invalid_initial_aggregate",
      cause,
    })
  ));
}

/** Constructs and owns the Application generation's sole legal initial state. */
export function makeApplicationTaskRunCreationInitialAggregateV1(
  input: ApplicationTaskRunCreationInitialAggregateInputV1,
): Result.Result<
  ApplicationTaskRunAttemptAggregateV1,
  InvalidTaskRunInitialAggregateError
> {
  const candidate: ApplicationTaskRunAttemptAggregateV1 = {
    ...initialFields(input), applicationTaskRuntimeTargetSha256: input.applicationTaskRuntimeTargetSha256,
  };
  return Result.gen(function* () {
    const encoded = yield* encodeApplicationTaskRunAttemptAggregateV1(candidate);
    return yield* decodeApplicationTaskRunAttemptAggregateV1(encoded);
  }).pipe(Result.mapError((cause) =>
    new InvalidTaskRunInitialAggregateError({
      operation: "make_initial_aggregate",
      reason: "invalid_initial_aggregate",
      cause,
    })
  ));
}

/** Identity-neutral initial fields shared by all admitted persisted generations. */
function initialFields(input: Omit<TaskRunCreationInitialAggregateInputV1, "taskDefinitionRevisionId">) {
  return {
    version: "flarex.task-run-attempt-aggregate.v1" as const,
    runId: input.runId, createdAtMs: input.createdAtMs, runVersion: runVersion(1n),
    boundPolicy: {
      runAttempt: input.runAttemptPolicy, maximumDurationMs: input.maximumDurationMs,
      initialComputeProfile: input.initialComputeProfile, leaseDurationMs: input.leaseDurationMs,
      immediateRetryThresholdMs: input.immediateRetryThresholdMs,
    },
    attemptHistory: { kind: "none" as const }, leaseHistory: { kind: "none" as const },
    lastLifecycleAcceptance: null, completionReplays: [], requestedEffectCursor: { kind: "none" as const },
    phase: "ready" as const, ready: { kind: "initial" as const, eligibleAtMs: input.createdAtMs },
    cancellation: { kind: "not_requested" as const, generation: cancellationGeneration(0n) },
  };
}
export function makeTrustedWorkflowTaskRunCreationInitialAggregate(input: {
  readonly runId: TaskRunIdV1; readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly trustedWorkflowBindingSha256: TrustedWorkflowBindingSha256;
  readonly boundPolicy: TaskRunAttemptBoundPolicyV1;
}): Result.Result<CurrentTaskRunAttemptAggregate, InvalidTaskRunInitialAggregateError> {
  const policy = input.boundPolicy;
  return encodeTrustedWorkflowTaskRunAttemptAggregate({
    ...initialFields({ runId: input.runId, createdAtMs: input.createdAtMs,
      runAttemptPolicy: policy.runAttempt, maximumDurationMs: policy.maximumDurationMs,
      initialComputeProfile: policy.initialComputeProfile, leaseDurationMs: policy.leaseDurationMs,
      immediateRetryThresholdMs: policy.immediateRetryThresholdMs }),
    definitionReference: { generation: "trusted_workflow", trustedWorkflowBindingSha256: input.trustedWorkflowBindingSha256 },
  }).pipe(Result.flatMap(decodeTrustedWorkflowTaskRunAttemptAggregate), Result.mapError(cause => new InvalidTaskRunInitialAggregateError({ operation: "make_initial_aggregate", reason: "invalid_initial_aggregate", cause })));
}
