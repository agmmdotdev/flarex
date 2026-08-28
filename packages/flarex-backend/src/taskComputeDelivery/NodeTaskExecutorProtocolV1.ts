import {
  type ApplicationTaskComputeDispatchRequestV1,
  type TaskComputeDispatchIdentityV1,
  TaskComputeDispatchIdentityV1Schema,
  type TaskComputeExecutionIdV1,
  TaskComputeExecutionIdV1Schema,
  validateApplicationTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  decodeTaskInputReferenceV1,
  type TaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import type {
  TaskCancellationGenerationV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeNodeTaskRuntimeArtifactPreimageV1,
  type NodeTaskRuntimeArtifactV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Schema } from "effect";
import { normalizeApplicationTaskWorkerValueV1 } from
  "flarex-protocol/internal/application-task-worker-v1";

import {
  decodeTaskExecutionPrincipalObjectV1,
  type TaskExecutionPrincipalObjectV1,
} from "../taskExecutionPrincipal/TaskExecutionPrincipalStore.js";
import type {
  TaskExecutionFailureCode,
  TaskExecutionInterruptionReason,
  TaskExecutionResult,
} from "./TaskExecutionSession.js";

export const NODE_TASK_EXECUTOR_START_FORMAT_V1 =
  "flarex.node-task-executor/start" as const;
export const NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1 =
  "flarex.node-task-executor/recovery" as const;
export const NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1 =
  "flarex.node-task-executor/health" as const;
export const NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1 =
  "flarex.node-task-executor/interruption" as const;
export const NODE_TASK_EXECUTOR_SETTLEMENT_FORMAT_V1 =
  "flarex.node-task-executor/settlement" as const;
export const NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1 =
  "flarex.node-task-executor/cleanup" as const;
export const NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 = 1 as const;
export const NODE_TASK_EXECUTOR_GENERATION_V1 = "application_v1" as const;

export type NodeTaskExecutorStartKeyV1 = string & {
  readonly NodeTaskExecutorStartKeyV1: unique symbol;
};
export type NodeTaskExecutorRecoveryKeyV1 = string & {
  readonly NodeTaskExecutorRecoveryKeyV1: unique symbol;
};
export type NodeTaskExecutorInterruptionKeyV1 = string & {
  readonly NodeTaskExecutorInterruptionKeyV1: unique symbol;
};
export type NodeTaskExecutorSessionIdV1 = string & {
  readonly NodeTaskExecutorSessionIdV1: unique symbol;
};

export interface NodeTaskExecutorLaunchCapabilityReferenceV1 {
  readonly format: "flarex.node-task-launch-capability-reference";
  readonly version: 1;
  readonly capabilityId: string;
  readonly boundStartKey: NodeTaskExecutorStartKeyV1;
  readonly expiresAtEpochMilliseconds: number;
}

export interface NodeTaskExecutorResourcePolicyV1 {
  readonly computeProfile: ApplicationTaskComputeDispatchRequestV1["computeProfile"];
  readonly resourceClassIdentity: string;
  readonly maximumDurationMilliseconds: number;
  readonly maximumCpuMilliseconds: number;
  readonly maximumMemoryBytes: number;
  readonly maximumTemporaryDiskBytes: number;
  readonly maximumProcesses: 1;
  readonly maximumFileDescriptors: number;
  readonly maximumOutputBytes: number;
  readonly maximumLogBytes: number;
  readonly maximumCallbackCalls: number;
  readonly maximumCallbackConcurrency: number;
  readonly outbound: "denied";
  readonly filesystem: "none";
  readonly nativeModules: "denied";
  readonly environmentVariables: "platform_only";
  readonly secrets: "denied";
  readonly childProcesses: "denied";
}

export interface NodeTaskExecutorTraceContextV1 {
  readonly traceId: string;
  readonly parentSpanId: string | null;
}

export interface NodeTaskExecutorStartRequestV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_START_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly generation: typeof NODE_TASK_EXECUTOR_GENERATION_V1;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly dispatch: ApplicationTaskComputeDispatchRequestV1;
  readonly nodeArtifactSha256Hex: string;
  readonly nodeArtifactCanonicalBytes: Uint8Array;
  readonly input: TaskInputReferenceV1;
  readonly principal: TaskExecutionPrincipalObjectV1;
  readonly absoluteDeadlineEpochMilliseconds: number;
  readonly resourcePolicy: NodeTaskExecutorResourcePolicyV1;
  readonly launchCapability: NodeTaskExecutorLaunchCapabilityReferenceV1;
  readonly trace: NodeTaskExecutorTraceContextV1;
}

export interface NodeTaskExecutorAcceptanceV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_START_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly kind: "accepted";
  readonly generation: typeof NODE_TASK_EXECUTOR_GENERATION_V1;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
}

export type NodeTaskExecutorStartRejectionReasonV1 =
  | "unsupported_compute_profile"
  | "artifact_unavailable"
  | "artifact_incompatible"
  | "deadline_expired"
  | "capacity_unavailable";

export type NodeTaskExecutorStartResponseV1 =
  | NodeTaskExecutorAcceptanceV1
  | Readonly<{
      readonly format: typeof NODE_TASK_EXECUTOR_START_FORMAT_V1;
      readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
      readonly kind: "rejected";
      readonly startKey: NodeTaskExecutorStartKeyV1;
      readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
      readonly reason: NodeTaskExecutorStartRejectionReasonV1;
      readonly retryable: boolean;
    }>;

export interface NodeTaskExecutorRecoveryRequestV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
}

export type NodeTaskExecutorRecoveryResponseV1 =
  | Readonly<{
      readonly format: typeof NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1;
      readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
      readonly kind: "accepted";
      readonly acceptance: NodeTaskExecutorAcceptanceV1;
    }>
  | Readonly<{
      readonly format: typeof NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1;
      readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
      readonly kind: "not_found";
      readonly startKey: NodeTaskExecutorStartKeyV1;
      readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
    }>
  | Readonly<{
      readonly format: typeof NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1;
      readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
      readonly kind: "session_lost";
      readonly startKey: NodeTaskExecutorStartKeyV1;
      readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
    }>;

export interface NodeTaskExecutorHealthRequestV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
}

export interface NodeTaskExecutorHealthEvidenceV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly kind: "healthy";
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
  readonly heartbeatSequence: bigint;
  readonly observedAtEpochMilliseconds: number;
  readonly state: "running" | "interruption_requested";
}

export interface NodeTaskExecutorInterruptionRequestV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly interruptionKey: NodeTaskExecutorInterruptionKeyV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
  readonly reason: TaskExecutionInterruptionReason;
}

export type NodeTaskExecutorInterruptionResponseV1 = Readonly<{
  readonly format: typeof NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly kind:
    | "interruption_requested"
    | "stale_generation"
    | "execution_not_found"
    | "session_lost";
  readonly interruptionKey: NodeTaskExecutorInterruptionKeyV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
  readonly reason: TaskExecutionInterruptionReason;
}>;

export type NodeTaskExecutorSettlementOutcomeV1 =
  | Readonly<{ readonly kind: "completed"; readonly result: TaskExecutionResult }>
  | Readonly<{
      readonly kind: "failed";
      readonly failure: Readonly<{
        readonly code: TaskExecutionFailureCode;
        readonly message: null;
      }>;
    }>
  | Readonly<{
      readonly kind: "interrupted";
      readonly interruption: Readonly<{
        readonly cancellationGeneration: TaskCancellationGenerationV1;
        readonly reason: TaskExecutionInterruptionReason;
      }>;
    }>;

export interface NodeTaskExecutorSettlementV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_SETTLEMENT_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly kind: "settled";
  readonly generation: typeof NODE_TASK_EXECUTOR_GENERATION_V1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly outcome: NodeTaskExecutorSettlementOutcomeV1;
}

export interface NodeTaskExecutorCleanupRequestV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
}

export interface NodeTaskExecutorCleanupOutcomeV1 {
  readonly format: typeof NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1;
  readonly version: typeof NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1;
  readonly kind: "cleaned" | "already_clean" | "session_lost";
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly recoveryKey: NodeTaskExecutorRecoveryKeyV1;
}

export class NodeTaskExecutorProtocolV1Error extends Data.TaggedError(
  "NodeTaskExecutorProtocolV1Error",
)<{
  readonly boundary:
    | "start"
    | "start_response"
    | "recovery"
    | "recovery_response"
    | "health"
    | "interruption"
    | "settlement"
    | "cleanup";
  readonly reason:
    | "invalid_shape"
    | "invalid_key"
    | "invalid_artifact"
    | "artifact_authentication_unavailable"
    | "artifact_digest_mismatch"
    | "invalid_principal"
    | "correlation_mismatch"
    | "policy_mismatch";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export type NodeTaskExecutorProtocolSha256 = (
  input: Uint8Array,
) => Effect.Effect<Uint8Array, unknown>;

const START_KEY_PREFIX = "flarex.node-task-executor/start-key/v1/";
const RECOVERY_KEY_PREFIX = "flarex.node-task-executor/recovery-key/v1/";
const INTERRUPTION_KEY_PREFIX =
  "flarex.node-task-executor/interruption-key/v1/";
const VISIBLE_ASCII = /^[\x21-\x7e]{1,1024}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const TRACE_ID = /^[0-9a-f]{32}$/u;
const SPAN_ID = /^[0-9a-f]{16}$/u;
const POSITIVE_SAFE_INTEGER = Schema.Number.check(Schema.makeFilter(value =>
  Number.isSafeInteger(value) && value > 0
    ? undefined
    : "Expected a positive safe integer"
));
const decodePositiveSafeInteger = Schema.decodeUnknownResult(
  POSITIVE_SAFE_INTEGER,
);
const decodeExecutionId = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeExecutionIdV1Schema),
  { onExcessProperty: "error" },
);
const decodeDispatchIdentity = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeDispatchIdentityV1Schema),
  { onExcessProperty: "error" },
);

export function makeNodeTaskExecutorStartKeyV1(
  identity: TaskComputeDispatchIdentityV1,
  executionId: TaskComputeExecutionIdV1,
): NodeTaskExecutorStartKeyV1 {
  return `${START_KEY_PREFIX}${keySuffix(identity, executionId)}` as
    NodeTaskExecutorStartKeyV1;
}

export function makeNodeTaskExecutorRecoveryKeyV1(
  identity: TaskComputeDispatchIdentityV1,
  executionId: TaskComputeExecutionIdV1,
): NodeTaskExecutorRecoveryKeyV1 {
  return `${RECOVERY_KEY_PREFIX}${keySuffix(identity, executionId)}` as
    NodeTaskExecutorRecoveryKeyV1;
}

export function makeNodeTaskExecutorInterruptionKeyV1(
  identity: TaskComputeDispatchIdentityV1,
  executionId: TaskComputeExecutionIdV1,
  cancellationGeneration: TaskCancellationGenerationV1,
): NodeTaskExecutorInterruptionKeyV1 {
  return `${INTERRUPTION_KEY_PREFIX}${keySuffix(identity, executionId)}/${
    cancellationGeneration.toString(10)
  }` as NodeTaskExecutorInterruptionKeyV1;
}

export function decodeNodeTaskExecutorStartRequestV1(
  input: unknown,
): Result.Result<NodeTaskExecutorStartRequestV1, NodeTaskExecutorProtocolV1Error> {
  const boundary = "start" as const;
  const outer = captureExactDataRecord(input, [
    "format", "version", "generation", "startKey", "recoveryKey",
    "executionId", "dispatch", "nodeArtifactSha256Hex",
    "nodeArtifactCanonicalBytes", "input", "principal",
    "absoluteDeadlineEpochMilliseconds", "resourcePolicy",
    "launchCapability", "trace",
  ]);
  if (
    outer === undefined || outer.format !== NODE_TASK_EXECUTOR_START_FORMAT_V1 ||
    outer.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    outer.generation !== NODE_TASK_EXECUTOR_GENERATION_V1
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.gen(function* () {
    const dispatch = yield* validateApplicationTaskComputeDispatchRequestV1(
      outer.dispatch,
    ).pipe(Result.mapError(cause => invalid(
      boundary, "invalid_shape", "dispatch", cause,
    )));
    const executionId = yield* decodeExecutionId(outer.executionId).pipe(
      Result.mapError(cause => invalid(
        boundary, "invalid_shape", "executionId", cause,
      )),
    );
    const startKey = yield* decodeStartKey(
      outer.startKey,
      dispatch.identity,
      executionId,
      boundary,
    );
    const recoveryKey = yield* decodeRecoveryKey(
      outer.recoveryKey,
      dispatch.identity,
      executionId,
      boundary,
    );
    if (
      typeof outer.nodeArtifactSha256Hex !== "string" ||
      !SHA256_HEX.test(outer.nodeArtifactSha256Hex)
    ) return yield* Result.fail(invalid(
      boundary, "invalid_shape", "nodeArtifactSha256Hex",
    ));
    const artifactBytes = captureBytes(outer.nodeArtifactCanonicalBytes);
    if (artifactBytes === undefined) {
      return yield* Result.fail(invalid(
        boundary, "invalid_artifact", "nodeArtifactCanonicalBytes",
      ));
    }
    const artifact = yield* decodeNodeTaskRuntimeArtifactPreimageV1(
      artifactBytes,
    ).pipe(Result.mapError(cause => invalid(
      boundary, "invalid_artifact", "nodeArtifactCanonicalBytes", cause,
    )));
    if (!artifact.supportedComputeProfiles.includes(dispatch.computeProfile)) {
      return yield* Result.fail(invalid(
        boundary, "policy_mismatch", "dispatch.computeProfile",
      ));
    }
    const inputReference = yield* decodeTaskInputReferenceV1(outer.input).pipe(
      Result.mapError(cause => invalid(
        boundary, "invalid_shape", "input", cause,
      )),
    );
    const principal = yield* decodeTaskExecutionPrincipalObjectV1(
      outer.principal,
    ).pipe(Result.mapError(() => invalid(
        boundary, "invalid_principal", "principal",
      )));
    if (principal.scopeId !== dispatch.identity.scopeId) {
      return yield* Result.fail(invalid(
        boundary, "correlation_mismatch", "principal.scopeId",
      ));
    }
    const deadline = yield* decodePositiveSafeInteger(
      outer.absoluteDeadlineEpochMilliseconds,
    ).pipe(Result.mapError(cause => invalid(
      boundary,
      "invalid_shape",
      "absoluteDeadlineEpochMilliseconds",
      cause,
    )));
    const resourcePolicy = yield* decodeResourcePolicy(
      outer.resourcePolicy,
      dispatch,
      boundary,
    );
    const launchCapability = yield* decodeLaunchCapability(
      outer.launchCapability,
      startKey,
      deadline,
      boundary,
    );
    const trace = yield* decodeTrace(outer.trace, boundary);
    return Object.freeze({
      format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      generation: NODE_TASK_EXECUTOR_GENERATION_V1,
      startKey,
      recoveryKey,
      executionId,
      dispatch,
      nodeArtifactSha256Hex: outer.nodeArtifactSha256Hex,
      nodeArtifactCanonicalBytes: artifactBytes,
      input: inputReference,
      principal,
      absoluteDeadlineEpochMilliseconds: deadline,
      resourcePolicy,
      launchCapability,
      trace,
    });
  });
}

export const authenticateNodeTaskExecutorStartRequestV1 = Effect.fn(
  "NodeTaskExecutorProtocol.authenticateStartRequestV1",
)(function* (
  input: unknown,
  sha256: NodeTaskExecutorProtocolSha256,
) {
  const request = yield* Effect.fromResult(
    decodeNodeTaskExecutorStartRequestV1(input),
  );
  const digest = yield* sha256(copyBytes(
    request.nodeArtifactCanonicalBytes,
  )).pipe(
    Effect.mapError(cause => invalid(
      "start",
      "artifact_authentication_unavailable",
      "nodeArtifactCanonicalBytes",
      cause,
    )),
  );
  if (!isUint8ArrayWithByteLength(digest, 32)) {
    return yield* invalid(
      "start",
      "artifact_authentication_unavailable",
      "nodeArtifactCanonicalBytes",
    );
  }
  const actual = encodeBytesToLowercaseHex(digest);
  if (actual !== request.nodeArtifactSha256Hex) {
    return yield* invalid(
      "start",
      "artifact_digest_mismatch",
      "nodeArtifactSha256Hex",
    );
  }
  return request;
});

export function decodeNodeTaskExecutorStartResponseV1(
  input: unknown,
): Result.Result<NodeTaskExecutorStartResponseV1, NodeTaskExecutorProtocolV1Error> {
  const boundary = "start_response" as const;
  const record = captureDataRecord(input);
  if (
    record === undefined || record.format !== NODE_TASK_EXECUTOR_START_FORMAT_V1 ||
    record.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  if (record.kind === "accepted") {
    return decodeAcceptance(record, boundary);
  }
  const rejected = captureExactDataRecord(record, [
    "format", "version", "kind", "startKey", "recoveryKey", "reason",
    "retryable",
  ]);
  if (
    rejected === undefined || rejected.kind !== "rejected" ||
    !isStartKey(rejected.startKey) || !isRecoveryKey(rejected.recoveryKey) ||
    !isStartRejectionReason(rejected.reason) ||
    typeof rejected.retryable !== "boolean"
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.succeed(Object.freeze({
    format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: "rejected" as const,
    startKey: rejected.startKey,
    recoveryKey: rejected.recoveryKey,
    reason: rejected.reason,
    retryable: rejected.retryable,
  }));
}

export function decodeNodeTaskExecutorRecoveryRequestV1(
  input: unknown,
): Result.Result<
  NodeTaskExecutorRecoveryRequestV1,
  NodeTaskExecutorProtocolV1Error
> {
  const boundary = "recovery" as const;
  const outer = captureExactDataRecord(input, [
    "format", "version", "startKey", "recoveryKey", "identity", "executionId",
  ]);
  if (
    outer === undefined || outer.format !== NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1 ||
    outer.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return decodeIdentityAndKeys(outer, boundary).pipe(Result.map(value =>
    Object.freeze({
      format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      ...value,
    })
  ));
}

export function decodeNodeTaskExecutorRecoveryResponseV1(
  input: unknown,
): Result.Result<
  NodeTaskExecutorRecoveryResponseV1,
  NodeTaskExecutorProtocolV1Error
> {
  const boundary = "recovery_response" as const;
  const record = captureDataRecord(input);
  if (
    record === undefined ||
    record.format !== NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1 ||
    record.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  if (record.kind === "accepted") {
    const accepted = captureExactDataRecord(record, [
      "format", "version", "kind", "acceptance",
    ]);
    if (accepted === undefined) {
      return Result.fail(invalid(boundary, "invalid_shape"));
    }
    return decodeAcceptance(accepted.acceptance, boundary).pipe(Result.map(
      acceptance => Object.freeze({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        kind: "accepted" as const,
        acceptance,
      }),
    ));
  }
  const missing = captureExactDataRecord(record, [
    "format", "version", "kind", "startKey", "recoveryKey",
  ]);
  if (
    missing === undefined ||
    (missing.kind !== "not_found" && missing.kind !== "session_lost") ||
    !isStartKey(missing.startKey) || !isRecoveryKey(missing.recoveryKey)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.succeed(Object.freeze({
    format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: missing.kind,
    startKey: missing.startKey,
    recoveryKey: missing.recoveryKey,
  }));
}

export function decodeNodeTaskExecutorHealthRequestV1(
  input: unknown,
): Result.Result<NodeTaskExecutorHealthRequestV1, NodeTaskExecutorProtocolV1Error> {
  const boundary = "health" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "sessionId", "recoveryKey",
  ]);
  if (
    value === undefined || value.format !== NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    !isSessionId(value.sessionId) || !isRecoveryKey(value.recoveryKey)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.succeed(Object.freeze({
    format: NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    sessionId: value.sessionId,
    recoveryKey: value.recoveryKey,
  }));
}

export function decodeNodeTaskExecutorHealthEvidenceV1(
  input: unknown,
): Result.Result<NodeTaskExecutorHealthEvidenceV1, NodeTaskExecutorProtocolV1Error> {
  const boundary = "health" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "kind", "sessionId", "recoveryKey",
    "heartbeatSequence", "observedAtEpochMilliseconds", "state",
  ]);
  const recoveryKey = value?.recoveryKey;
  if (
    value === undefined || value.format !== NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    value.kind !== "healthy" || !isSessionId(value.sessionId) ||
    !isRecoveryKey(recoveryKey) ||
    typeof value.heartbeatSequence !== "bigint" ||
    value.heartbeatSequence < 1n ||
    (value.state !== "running" && value.state !== "interruption_requested")
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return decodePositiveSafeInteger(value.observedAtEpochMilliseconds).pipe(
    Result.mapError(cause => invalid(
      boundary, "invalid_shape", "observedAtEpochMilliseconds", cause,
    )),
    Result.map(observedAtEpochMilliseconds => Object.freeze({
      format: NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "healthy" as const,
      sessionId: value.sessionId as NodeTaskExecutorSessionIdV1,
      recoveryKey,
      heartbeatSequence: value.heartbeatSequence as bigint,
      observedAtEpochMilliseconds,
      state: value.state as "running" | "interruption_requested",
    })),
  );
}

export function decodeNodeTaskExecutorInterruptionRequestV1(
  input: unknown,
): Result.Result<
  NodeTaskExecutorInterruptionRequestV1,
  NodeTaskExecutorProtocolV1Error
> {
  const boundary = "interruption" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "interruptionKey", "sessionId", "recoveryKey",
    "identity", "executionId", "cancellationGeneration", "reason",
  ]);
  const recoveryKey = value?.recoveryKey;
  if (
    value === undefined ||
    value.format !== NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    !isSessionId(value.sessionId) || !isRecoveryKey(recoveryKey) ||
    typeof value.cancellationGeneration !== "bigint" ||
    value.cancellationGeneration < 1n || !isInterruptionReason(value.reason)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.gen(function* () {
    const { identity, executionId } = yield* decodeIdentity(
      value.identity,
      value.executionId,
      boundary,
    );
    const canonicalRecoveryKey = yield* decodeRecoveryKey(
      recoveryKey,
      identity,
      executionId,
      boundary,
    );
    const expected = makeNodeTaskExecutorInterruptionKeyV1(
      identity,
      executionId,
      value.cancellationGeneration as TaskCancellationGenerationV1,
    );
    if (value.interruptionKey !== expected) {
      return yield* Result.fail(invalid(
        boundary, "invalid_key", "interruptionKey",
      ));
    }
    return Object.freeze({
      format: NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      interruptionKey: expected,
      sessionId: value.sessionId as NodeTaskExecutorSessionIdV1,
      recoveryKey: canonicalRecoveryKey,
      identity,
      executionId,
      cancellationGeneration:
        value.cancellationGeneration as TaskCancellationGenerationV1,
      reason: value.reason as TaskExecutionInterruptionReason,
    });
  });
}

export function decodeNodeTaskExecutorInterruptionResponseV1(
  input: unknown,
): Result.Result<
  NodeTaskExecutorInterruptionResponseV1,
  NodeTaskExecutorProtocolV1Error
> {
  const boundary = "interruption" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "kind", "interruptionKey", "sessionId",
    "cancellationGeneration", "reason",
  ]);
  if (
    value === undefined ||
    value.format !== NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    (value.kind !== "interruption_requested" &&
      value.kind !== "stale_generation" &&
      value.kind !== "execution_not_found" && value.kind !== "session_lost") ||
    !isInterruptionKey(value.interruptionKey) ||
    !isSessionId(value.sessionId) ||
    typeof value.cancellationGeneration !== "bigint" ||
    value.cancellationGeneration < 1n || !isInterruptionReason(value.reason)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.succeed(Object.freeze({
    format: NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: value.kind,
    interruptionKey: value.interruptionKey,
    sessionId: value.sessionId,
    cancellationGeneration:
      value.cancellationGeneration as TaskCancellationGenerationV1,
    reason: value.reason,
  }));
}

export function decodeNodeTaskExecutorSettlementV1(
  input: unknown,
): Result.Result<NodeTaskExecutorSettlementV1, NodeTaskExecutorProtocolV1Error> {
  const boundary = "settlement" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "kind", "generation", "sessionId", "recoveryKey",
    "identity", "executionId", "outcome",
  ]);
  const recoveryKey = value?.recoveryKey;
  if (
    value === undefined || value.format !== NODE_TASK_EXECUTOR_SETTLEMENT_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    value.kind !== "settled" || value.generation !== NODE_TASK_EXECUTOR_GENERATION_V1 ||
    !isSessionId(value.sessionId) || !isRecoveryKey(recoveryKey)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.gen(function* () {
    const correlated = yield* decodeIdentity(
      value.identity,
      value.executionId,
      boundary,
    );
    const outcome = yield* decodeSettlementOutcome(value.outcome, boundary);
    return Object.freeze({
      format: NODE_TASK_EXECUTOR_SETTLEMENT_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "settled" as const,
      generation: NODE_TASK_EXECUTOR_GENERATION_V1,
      sessionId: value.sessionId as NodeTaskExecutorSessionIdV1,
      recoveryKey,
      ...correlated,
      outcome,
    });
  });
}

export function decodeNodeTaskExecutorCleanupRequestV1(
  input: unknown,
): Result.Result<NodeTaskExecutorCleanupRequestV1, NodeTaskExecutorProtocolV1Error> {
  const boundary = "cleanup" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "sessionId", "recoveryKey",
  ]);
  if (
    value === undefined || value.format !== NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    !isSessionId(value.sessionId) || !isRecoveryKey(value.recoveryKey)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.succeed(Object.freeze({
    format: NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    sessionId: value.sessionId,
    recoveryKey: value.recoveryKey,
  }));
}

export function decodeNodeTaskExecutorCleanupOutcomeV1(
  input: unknown,
): Result.Result<
  NodeTaskExecutorCleanupOutcomeV1,
  NodeTaskExecutorProtocolV1Error
> {
  const boundary = "cleanup" as const;
  const value = captureExactDataRecord(input, [
    "format", "version", "kind", "sessionId", "recoveryKey",
  ]);
  if (
    value === undefined || value.format !== NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    (value.kind !== "cleaned" && value.kind !== "already_clean" &&
      value.kind !== "session_lost") ||
    !isSessionId(value.sessionId) || !isRecoveryKey(value.recoveryKey)
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return Result.succeed(Object.freeze({
    format: NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: value.kind,
    sessionId: value.sessionId as NodeTaskExecutorSessionIdV1,
    recoveryKey: value.recoveryKey,
  }));
}

function decodeAcceptance(
  input: unknown,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
): Result.Result<NodeTaskExecutorAcceptanceV1, NodeTaskExecutorProtocolV1Error> {
  const value = captureExactDataRecord(input, [
    "format", "version", "kind", "generation", "startKey", "recoveryKey",
    "identity", "executionId", "sessionId", "cancellationGeneration",
  ]);
  if (
    value === undefined || value.format !== NODE_TASK_EXECUTOR_START_FORMAT_V1 ||
    value.version !== NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1 ||
    value.kind !== "accepted" || value.generation !== NODE_TASK_EXECUTOR_GENERATION_V1 ||
    !isSessionId(value.sessionId) ||
    typeof value.cancellationGeneration !== "bigint" ||
    value.cancellationGeneration < 0n
  ) return Result.fail(invalid(boundary, "invalid_shape"));
  return decodeIdentityAndKeys(value, boundary).pipe(Result.map(correlated =>
    Object.freeze({
      format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "accepted" as const,
      generation: NODE_TASK_EXECUTOR_GENERATION_V1,
      ...correlated,
      sessionId: value.sessionId as NodeTaskExecutorSessionIdV1,
      cancellationGeneration:
        value.cancellationGeneration as TaskCancellationGenerationV1,
    })
  ));
}

function decodeIdentityAndKeys(
  value: Readonly<Record<string, unknown>>,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
) {
  return decodeIdentity(value.identity, value.executionId, boundary).pipe(
    Result.flatMap(({ identity, executionId }) => Result.gen(function* () {
      const startKey = yield* decodeStartKey(
        value.startKey,
        identity,
        executionId,
        boundary,
      );
      const recoveryKey = yield* decodeRecoveryKey(
        value.recoveryKey,
        identity,
        executionId,
        boundary,
      );
      return Object.freeze({ startKey, recoveryKey, identity, executionId });
    })),
  );
}

function decodeIdentity(
  identityInput: unknown,
  executionIdInput: unknown,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
) {
  return Result.gen(function* () {
    const identity = yield* decodeDispatchIdentity(identityInput).pipe(
      Result.mapError(cause => invalid(
      boundary, "invalid_shape", "identity", cause,
      )),
    );
    const executionId = yield* decodeExecutionId(executionIdInput).pipe(
      Result.mapError(cause => invalid(
        boundary, "invalid_shape", "executionId", cause,
      )),
    );
    return Object.freeze({ identity, executionId });
  });
}

function decodeStartKey(
  input: unknown,
  identity: TaskComputeDispatchIdentityV1,
  executionId: TaskComputeExecutionIdV1,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
) {
  const expected = makeNodeTaskExecutorStartKeyV1(identity, executionId);
  return input === expected
    ? Result.succeed(expected)
    : Result.fail(invalid(boundary, "invalid_key", "startKey"));
}

function decodeRecoveryKey(
  input: unknown,
  identity: TaskComputeDispatchIdentityV1,
  executionId: TaskComputeExecutionIdV1,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
) {
  const expected = makeNodeTaskExecutorRecoveryKeyV1(identity, executionId);
  return input === expected
    ? Result.succeed(expected)
    : Result.fail(invalid(boundary, "invalid_key", "recoveryKey"));
}

function decodeResourcePolicy(
  input: unknown,
  dispatch: ApplicationTaskComputeDispatchRequestV1,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
): Result.Result<
  NodeTaskExecutorResourcePolicyV1,
  NodeTaskExecutorProtocolV1Error
> {
  const value = captureExactDataRecord(input, [
    "computeProfile", "resourceClassIdentity", "maximumDurationMilliseconds",
    "maximumCpuMilliseconds", "maximumMemoryBytes",
    "maximumTemporaryDiskBytes", "maximumProcesses",
    "maximumFileDescriptors", "maximumOutputBytes", "maximumLogBytes",
    "maximumCallbackCalls", "maximumCallbackConcurrency", "outbound",
    "filesystem", "nativeModules", "environmentVariables", "secrets",
    "childProcesses",
  ]);
  if (
    value === undefined || value.computeProfile !== dispatch.computeProfile ||
    typeof value.resourceClassIdentity !== "string" ||
    !VISIBLE_ASCII.test(value.resourceClassIdentity) ||
    value.maximumDurationMilliseconds !== dispatch.maximumDurationMs ||
    !isPositiveSafeInteger(value.maximumCpuMilliseconds) ||
    !isPositiveSafeInteger(value.maximumMemoryBytes) ||
    !isPositiveSafeInteger(value.maximumTemporaryDiskBytes) ||
    value.maximumProcesses !== 1 ||
    !isPositiveSafeInteger(value.maximumFileDescriptors) ||
    !isPositiveSafeInteger(value.maximumOutputBytes) ||
    !isPositiveSafeInteger(value.maximumLogBytes) ||
    !isPositiveSafeInteger(value.maximumCallbackCalls) ||
    !isPositiveSafeInteger(value.maximumCallbackConcurrency) ||
    value.outbound !== "denied" || value.filesystem !== "none" ||
    value.nativeModules !== "denied" ||
    value.environmentVariables !== "platform_only" ||
    value.secrets !== "denied" ||
    value.childProcesses !== "denied"
  ) return Result.fail(invalid(boundary, "policy_mismatch", "resourcePolicy"));
  return Result.succeed(Object.freeze({
    computeProfile: dispatch.computeProfile,
    resourceClassIdentity: value.resourceClassIdentity,
    maximumDurationMilliseconds: dispatch.maximumDurationMs,
    maximumCpuMilliseconds: value.maximumCpuMilliseconds,
    maximumMemoryBytes: value.maximumMemoryBytes,
    maximumTemporaryDiskBytes: value.maximumTemporaryDiskBytes,
    maximumProcesses: 1 as const,
    maximumFileDescriptors: value.maximumFileDescriptors,
    maximumOutputBytes: value.maximumOutputBytes,
    maximumLogBytes: value.maximumLogBytes,
    maximumCallbackCalls: value.maximumCallbackCalls,
    maximumCallbackConcurrency: value.maximumCallbackConcurrency,
    outbound: "denied" as const,
    filesystem: "none" as const,
    nativeModules: "denied" as const,
    environmentVariables: "platform_only" as const,
    secrets: "denied" as const,
    childProcesses: "denied" as const,
  }));
}

function decodeLaunchCapability(
  input: unknown,
  startKey: NodeTaskExecutorStartKeyV1,
  deadline: number,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
) {
  const value = captureExactDataRecord(input, [
    "format", "version", "capabilityId", "boundStartKey",
    "expiresAtEpochMilliseconds",
  ]);
  if (
    value === undefined ||
    value.format !== "flarex.node-task-launch-capability-reference" ||
    value.version !== 1 || typeof value.capabilityId !== "string" ||
    !VISIBLE_ASCII.test(value.capabilityId) || value.boundStartKey !== startKey
  ) return Result.fail(invalid(
    boundary, "correlation_mismatch", "launchCapability",
  ));
  return decodePositiveSafeInteger(value.expiresAtEpochMilliseconds).pipe(
    Result.mapError(cause => invalid(
      boundary,
      "invalid_shape",
      "launchCapability.expiresAtEpochMilliseconds",
      cause,
    )),
    Result.flatMap(expiresAtEpochMilliseconds =>
      expiresAtEpochMilliseconds > deadline
        ? Result.fail(invalid(
          boundary, "policy_mismatch", "launchCapability.expiresAtEpochMilliseconds",
        ))
        : Result.succeed(Object.freeze({
          format: "flarex.node-task-launch-capability-reference" as const,
          version: 1 as const,
          capabilityId: value.capabilityId as string,
          boundStartKey: startKey,
          expiresAtEpochMilliseconds,
        }))
    ),
  );
}

function decodeTrace(
  input: unknown,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
) {
  const value = captureExactDataRecord(input, ["traceId", "parentSpanId"]);
  if (
    value === undefined || typeof value.traceId !== "string" ||
    !TRACE_ID.test(value.traceId) ||
    (value.parentSpanId !== null &&
      (typeof value.parentSpanId !== "string" || !SPAN_ID.test(value.parentSpanId)))
  ) return Result.fail(invalid(boundary, "invalid_shape", "trace"));
  return Result.succeed(Object.freeze({
    traceId: value.traceId,
    parentSpanId: value.parentSpanId as string | null,
  }));
}

function decodeSettlementOutcome(
  input: unknown,
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
): Result.Result<
  NodeTaskExecutorSettlementOutcomeV1,
  NodeTaskExecutorProtocolV1Error
> {
  const value = captureDataRecord(input);
  if (value?.kind === "completed") {
    const completed = captureExactDataRecord(value, ["kind", "result"]);
    const result = captureExactDataRecord(completed?.result, [
      "value", "valueSemanticBytes",
    ]);
    if (completed === undefined || result === undefined) {
      return Result.fail(invalid(boundary, "invalid_shape", "outcome"));
    }
    return normalizeApplicationTaskWorkerValueV1(result.value, "result").pipe(
      Result.mapError(cause => invalid(
        boundary, "invalid_shape", "outcome.result.value", cause,
      )),
      Result.flatMap(normalized =>
        normalized.semanticSizeBytes !== result.valueSemanticBytes
          ? Result.fail(invalid(
            boundary, "correlation_mismatch",
            "outcome.result.valueSemanticBytes",
          ))
          : Result.succeed(Object.freeze({
            kind: "completed" as const,
            result: Object.freeze({
              value: normalized.value,
              valueSemanticBytes: normalized.semanticSizeBytes,
            }),
          }))
      ),
    );
  }
  if (value?.kind === "failed") {
    const failed = captureExactDataRecord(value, ["kind", "failure"]);
    const failure = captureExactDataRecord(failed?.failure, ["code", "message"]);
    if (
      failure === undefined || !isFailureCode(failure.code) ||
      failure.message !== null
    ) return Result.fail(invalid(boundary, "invalid_shape", "outcome"));
    return Result.succeed(Object.freeze({
      kind: "failed" as const,
      failure: Object.freeze({ code: failure.code, message: null }),
    }));
  }
  if (value?.kind === "interrupted") {
    const interrupted = captureExactDataRecord(value, ["kind", "interruption"]);
    const interruption = captureExactDataRecord(
      interrupted?.interruption,
      ["cancellationGeneration", "reason"],
    );
    if (
      interruption === undefined ||
      typeof interruption.cancellationGeneration !== "bigint" ||
      interruption.cancellationGeneration < 1n ||
      !isInterruptionReason(interruption.reason)
    ) return Result.fail(invalid(boundary, "invalid_shape", "outcome"));
    return Result.succeed(Object.freeze({
      kind: "interrupted" as const,
      interruption: Object.freeze({
        cancellationGeneration:
          interruption.cancellationGeneration as TaskCancellationGenerationV1,
        reason: interruption.reason,
      }),
    }));
  }
  return Result.fail(invalid(boundary, "invalid_shape", "outcome"));
}

function keySuffix(
  identity: TaskComputeDispatchIdentityV1,
  executionId: TaskComputeExecutionIdV1,
): string {
  return [
    identity.scopeId,
    identity.runId,
    identity.requestedEffectSequence.toString(10),
    identity.attemptId,
    identity.executionFence.toString(10),
    executionId,
  ].map(value => encodeURIComponent(value)).join("/");
}

function captureBytes(input: unknown): Uint8Array | undefined {
  if (!isUint8Array(input)) return undefined;
  try {
    return copyBytes(input);
  } catch {
    return undefined;
  }
}

function isPositiveSafeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0;
}

function captureDataRecord(
  input: unknown,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const captured: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
      Object.defineProperty(captured, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: descriptor.value,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  const record = captureDataRecord(input);
  if (record === undefined) return undefined;
  const keys = Reflect.ownKeys(record);
  return keys.length === expectedKeys.length && keys.every(
      key => typeof key === "string" && expectedKeys.includes(key),
    )
    ? record
    : undefined;
}

function isStartRejectionReason(
  input: unknown,
): input is NodeTaskExecutorStartRejectionReasonV1 {
  return input === "unsupported_compute_profile" ||
    input === "artifact_unavailable" || input === "artifact_incompatible" ||
    input === "deadline_expired" || input === "capacity_unavailable";
}

function isInterruptionReason(
  input: unknown,
): input is TaskExecutionInterruptionReason {
  return input === "cancellation_requested" || input === "maximum_duration" ||
    input === "host_shutdown";
}

function isFailureCode(input: unknown): input is TaskExecutionFailureCode {
  return input === "input_validation_failed" ||
    input === "output_validation_failed" || input === "handler_failed" ||
    input === "runtime_input_unavailable" ||
    input === "configuration_invalid" || input === "internal_invariant";
}

function isSessionId(input: unknown): input is NodeTaskExecutorSessionIdV1 {
  return typeof input === "string" && VISIBLE_ASCII.test(input);
}

function isStartKey(input: unknown): input is NodeTaskExecutorStartKeyV1 {
  return typeof input === "string" && input.startsWith(START_KEY_PREFIX) &&
    VISIBLE_ASCII.test(input);
}

function isRecoveryKey(input: unknown): input is NodeTaskExecutorRecoveryKeyV1 {
  return typeof input === "string" && input.startsWith(RECOVERY_KEY_PREFIX) &&
    VISIBLE_ASCII.test(input);
}

function isInterruptionKey(
  input: unknown,
): input is NodeTaskExecutorInterruptionKeyV1 {
  return typeof input === "string" &&
    input.startsWith(INTERRUPTION_KEY_PREFIX) && VISIBLE_ASCII.test(input);
}

function invalid(
  boundary: NodeTaskExecutorProtocolV1Error["boundary"],
  reason: NodeTaskExecutorProtocolV1Error["reason"],
  path?: string,
  cause?: unknown,
): NodeTaskExecutorProtocolV1Error {
  return new NodeTaskExecutorProtocolV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
