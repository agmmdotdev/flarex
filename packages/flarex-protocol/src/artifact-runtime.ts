import { Data, Effect, Schema } from "effect";
import {
  PushSourcePackage,
  type ActiveDeploymentStatus,
  type PushSourcePackage as PushSourcePackageType,
} from "./deployment";
import { isJson, type Json } from "./json";

const INVALID_INVOKE_PAYLOAD_MESSAGE = "Invalid execution artifact invoke payload.";

export type ExecutionArtifactInvokeRequest = {
  path: string;
  args: Json;
  partitionKey?: string;
  projectId?: string;
  kind?: "query" | "mutation" | "action" | "workflowMutation";
  idempotencyKey?: string;
};

export type ExecutionArtifactInvokePayload = {
  deploymentId: string;
  ref: ActiveDeploymentStatus["executionArtifactRef"];
  sourcePackage?: PushSourcePackageType;
  request: ExecutionArtifactInvokeRequest;
};

export class ExecutionArtifactInvokePayloadError extends Data.TaggedError(
  "ExecutionArtifactInvokePayloadError",
)<{
  readonly message: string;
}> {}

const decodeUnknownPushSourcePackage = Schema.decodeUnknownEffect(PushSourcePackage);

export const decodeExecutionArtifactInvokePayloadBodyEffect = Effect.fn(
  "ArtifactRuntimeProtocol.decodeInvokePayloadBody",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  const payload = yield* executionArtifactInvokePayloadValidationResultToEffect(
    normalizeExecutionArtifactInvokePayload(value),
  );
  if (payload.sourcePackage !== undefined) {
    yield* decodeUnknownPushSourcePackage(payload.sourcePackage).pipe(
      Effect.mapError(() =>
        new ExecutionArtifactInvokePayloadError({
          message: INVALID_INVOKE_PAYLOAD_MESSAGE,
        })
      ),
    );
  }
  return payload;
});

function normalizeExecutionArtifactInvokePayload(
  value: unknown,
): ExecutionArtifactInvokePayloadValidationResult<ExecutionArtifactInvokePayload> {
  if (isExecutionArtifactInvokePayload(value)) {
    return executionArtifactInvokePayloadValidationSuccess(value);
  }
  return executionArtifactInvokePayloadValidationFailure(INVALID_INVOKE_PAYLOAD_MESSAGE);
}

type ExecutionArtifactInvokePayloadValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: ExecutionArtifactInvokePayloadError;
    };

function executionArtifactInvokePayloadValidationSuccess<A>(
  value: A,
): ExecutionArtifactInvokePayloadValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function executionArtifactInvokePayloadValidationFailure<A = never>(
  message: string,
): ExecutionArtifactInvokePayloadValidationResult<A> {
  return {
    success: false,
    error: new ExecutionArtifactInvokePayloadError({ message }),
  };
}

function executionArtifactInvokePayloadValidationResultToEffect<A>(
  result: ExecutionArtifactInvokePayloadValidationResult<A>,
): Effect.Effect<A, ExecutionArtifactInvokePayloadError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function isExecutionArtifactInvokePayload(
  value: unknown,
): value is ExecutionArtifactInvokePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<ExecutionArtifactInvokePayload>;
  return (
    typeof payload.deploymentId === "string" &&
    isExecutionArtifactRef(payload.ref) &&
    (payload.sourcePackage === undefined ||
      (typeof payload.sourcePackage === "object" && payload.sourcePackage !== null)) &&
    isExecutionArtifactInvokeRequest(payload.request)
  );
}

function isExecutionArtifactRef(
  value: unknown,
): value is ActiveDeploymentStatus["executionArtifactRef"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const ref = value as Partial<ActiveDeploymentStatus["executionArtifactRef"]>;
  return (
    ref.runtime === "dynamic-worker" &&
    typeof ref.artifactId === "string" &&
    typeof ref.sourcePackageHash === "string" &&
    typeof ref.executionModule === "string"
  );
}

function isExecutionArtifactInvokeRequest(
  value: unknown,
): value is ExecutionArtifactInvokeRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const request = value as Partial<ExecutionArtifactInvokeRequest>;
  return (
    typeof request.path === "string" &&
    isJson(request.args) &&
    (request.partitionKey === undefined || typeof request.partitionKey === "string") &&
    (request.projectId === undefined || typeof request.projectId === "string") &&
    (
      request.kind === undefined ||
      request.kind === "query" ||
      request.kind === "mutation" ||
      request.kind === "action" ||
      request.kind === "workflowMutation"
    ) &&
    (request.idempotencyKey === undefined || typeof request.idempotencyKey === "string")
  );
}
