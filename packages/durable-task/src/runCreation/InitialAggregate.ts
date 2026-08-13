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
  const boundPolicy: TaskRunAttemptBoundPolicyV1 = {
    runAttempt: input.runAttemptPolicy,
    maximumDurationMs: input.maximumDurationMs,
    initialComputeProfile: input.initialComputeProfile,
    leaseDurationMs: input.leaseDurationMs,
    immediateRetryThresholdMs: input.immediateRetryThresholdMs,
  };
  const candidate: TaskRunAttemptAggregateV1 = {
    version: "flarex.task-run-attempt-aggregate.v1",
    runId: input.runId,
    taskDefinitionRevisionId: input.taskDefinitionRevisionId,
    createdAtMs: input.createdAtMs,
    runVersion: runVersion(1n),
    boundPolicy,
    attemptHistory: { kind: "none" },
    leaseHistory: { kind: "none" },
    lastLifecycleAcceptance: null,
    completionReplays: [],
    requestedEffectCursor: { kind: "none" },
    phase: "ready",
    ready: { kind: "initial", eligibleAtMs: input.createdAtMs },
    cancellation: {
      kind: "not_requested",
      generation: cancellationGeneration(0n),
    },
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
    version: "flarex.task-run-attempt-aggregate.v1",
    runId: input.runId,
    applicationTaskRuntimeTargetSha256:
      input.applicationTaskRuntimeTargetSha256,
    createdAtMs: input.createdAtMs,
    runVersion: runVersion(1n),
    boundPolicy: {
      runAttempt: input.runAttemptPolicy,
      maximumDurationMs: input.maximumDurationMs,
      initialComputeProfile: input.initialComputeProfile,
      leaseDurationMs: input.leaseDurationMs,
      immediateRetryThresholdMs: input.immediateRetryThresholdMs,
    },
    attemptHistory: { kind: "none" },
    leaseHistory: { kind: "none" },
    lastLifecycleAcceptance: null,
    completionReplays: [],
    requestedEffectCursor: { kind: "none" },
    phase: "ready",
    ready: { kind: "initial", eligibleAtMs: input.createdAtMs },
    cancellation: {
      kind: "not_requested",
      generation: cancellationGeneration(0n),
    },
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
