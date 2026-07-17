import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Schema } from "effect";
import {
  PushSourcePackage,
  type ActiveDeploymentStatus,
  type PushSourcePackage as PushSourcePackageType,
} from "./deployment";
import {
  ExecutionIdentitySchema,
  type ExecutionIdentity,
} from "./auth";
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

export type ExecutionArtifactInvokePayloadFor<
  TRef extends ActiveDeploymentStatus["executionArtifactRef"] = ActiveDeploymentStatus["executionArtifactRef"],
  TRequest extends ExecutionArtifactInvokeRequest = ExecutionArtifactInvokeRequest,
  TSourcePackage extends PushSourcePackageType = PushSourcePackageType,
> = {
  deploymentId: string;
  identity: ExecutionIdentity;
  ref: TRef;
  sourcePackage?: TSourcePackage;
  request: TRequest;
};

export type MaterializedExecutionArtifactInvokePayloadFor<
  TRef extends ActiveDeploymentStatus["executionArtifactRef"] = ActiveDeploymentStatus["executionArtifactRef"],
  TRequest extends ExecutionArtifactInvokeRequest = ExecutionArtifactInvokeRequest,
  TSourcePackage extends PushSourcePackageType = PushSourcePackageType,
> = ExecutionArtifactInvokePayloadFor<TRef, TRequest, TSourcePackage> & {
  sourcePackage: TSourcePackage;
};

export type ExecutionArtifactInvokePayload = ExecutionArtifactInvokePayloadFor;

export type MaterializedExecutionArtifactInvokePayload =
  MaterializedExecutionArtifactInvokePayloadFor;

export type ExecutionArtifactInvokePayloadOptions<
  TRef extends ActiveDeploymentStatus["executionArtifactRef"] = ActiveDeploymentStatus["executionArtifactRef"],
  TRequest extends ExecutionArtifactInvokeRequest = ExecutionArtifactInvokeRequest,
  TSourcePackage extends PushSourcePackageType = PushSourcePackageType,
> = {
  readonly deploymentId: string;
  readonly identity?: ExecutionIdentity | undefined;
  readonly ref: TRef;
  readonly request: TRequest;
  readonly sourcePackage?: TSourcePackage | undefined;
};

export type MaterializedExecutionArtifactInvokePayloadOptions<
  TRef extends ActiveDeploymentStatus["executionArtifactRef"] = ActiveDeploymentStatus["executionArtifactRef"],
  TRequest extends ExecutionArtifactInvokeRequest = ExecutionArtifactInvokeRequest,
  TSourcePackage extends PushSourcePackageType = PushSourcePackageType,
> =
  Omit<ExecutionArtifactInvokePayloadOptions<TRef, TRequest, TSourcePackage>, "sourcePackage"> & {
    readonly sourcePackage: TSourcePackage;
  };

export class ExecutionArtifactInvokePayloadError extends Data.TaggedError(
  "ExecutionArtifactInvokePayloadError",
)<{
  readonly message: string;
}> {}

const decodeUnknownPushSourcePackage = Schema.decodeUnknownEffect(PushSourcePackage);
const decodeUnknownExecutionIdentity = Schema.decodeUnknownEffect(ExecutionIdentitySchema);

export function executionArtifactInvokePayload<
  TRef extends ActiveDeploymentStatus["executionArtifactRef"],
  TRequest extends ExecutionArtifactInvokeRequest,
  TSourcePackage extends PushSourcePackageType,
>(
  options: ExecutionArtifactInvokePayloadOptions<TRef, TRequest, TSourcePackage>,
): ExecutionArtifactInvokePayloadFor<TRef, TRequest, TSourcePackage> {
  return {
    deploymentId: options.deploymentId,
    identity: options.identity ?? { kind: "anonymous" },
    ref: options.ref,
    ...(options.sourcePackage === undefined ? {} : { sourcePackage: options.sourcePackage }),
    request: options.request,
  };
}

export function materializedExecutionArtifactInvokePayload<
  TRef extends ActiveDeploymentStatus["executionArtifactRef"],
  TRequest extends ExecutionArtifactInvokeRequest,
  TSourcePackage extends PushSourcePackageType,
>(
  options: MaterializedExecutionArtifactInvokePayloadOptions<TRef, TRequest, TSourcePackage>,
): MaterializedExecutionArtifactInvokePayloadFor<TRef, TRequest, TSourcePackage> {
  return {
    deploymentId: options.deploymentId,
    identity: options.identity ?? { kind: "anonymous" },
    ref: options.ref,
    sourcePackage: options.sourcePackage,
    request: options.request,
  };
}

export const decodeExecutionArtifactInvokePayloadBodyEffect = Effect.fn(
  "ArtifactRuntimeProtocol.decodeInvokePayloadBody",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  const payload = yield* Effect.fromResult(
    normalizeExecutionArtifactInvokePayload(value),
  );
  yield* decodeUnknownExecutionIdentity(payload.identity).pipe(
    Effect.mapError(() =>
      new ExecutionArtifactInvokePayloadError({
        message: INVALID_INVOKE_PAYLOAD_MESSAGE,
      })
    ),
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
): Result.Result<
  ExecutionArtifactInvokePayload,
  ExecutionArtifactInvokePayloadError
> {
  if (isExecutionArtifactInvokePayload(value)) {
    return Result.succeed(value);
  }
  return Result.fail(new ExecutionArtifactInvokePayloadError({
    message: INVALID_INVOKE_PAYLOAD_MESSAGE,
  }));
}

function isExecutionArtifactInvokePayload(
  value: unknown,
): value is ExecutionArtifactInvokePayload {
  if (!isNonArrayRecord(value)) return false;
  return (
    typeof value.deploymentId === "string" &&
    value.identity !== undefined &&
    isExecutionArtifactRef(value.ref) &&
    (value.sourcePackage === undefined ||
      (typeof value.sourcePackage === "object" && value.sourcePackage !== null)) &&
    isExecutionArtifactInvokeRequest(value.request)
  );
}

function isExecutionArtifactRef(
  value: unknown,
): value is ActiveDeploymentStatus["executionArtifactRef"] {
  if (!isNonArrayRecord(value)) return false;
  return (
    value.runtime === "dynamic-worker" &&
    typeof value.artifactId === "string" &&
    typeof value.sourcePackageHash === "string" &&
    typeof value.executionModule === "string"
  );
}

function isExecutionArtifactInvokeRequest(
  value: unknown,
): value is ExecutionArtifactInvokeRequest {
  if (!isNonArrayRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    isJson(value.args) &&
    (value.partitionKey === undefined || typeof value.partitionKey === "string") &&
    (value.projectId === undefined || typeof value.projectId === "string") &&
    (
      value.kind === undefined ||
      value.kind === "query" ||
      value.kind === "mutation" ||
      value.kind === "action" ||
      value.kind === "workflowMutation"
    ) &&
    (value.idempotencyKey === undefined || typeof value.idempotencyKey === "string")
  );
}
