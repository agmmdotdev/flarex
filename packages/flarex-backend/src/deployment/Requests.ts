import { Effect } from "effect";
import {
  decodeAbandonPushRequestEffect,
  decodeAnalyzedStartPushRequestEffect,
  decodeFinishPushRequestEffect,
  decodePushSourcePackageEffect,
  decodeStartPushRequestEffect,
  DeploymentProtocolValidationError,
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  type FinishPushRequest,
  type StartPushRequest as ProtocolStartPushRequest,
} from "flarex-protocol/deployment";
import type { StartPushRequest } from "../types";

export const decodeDeploymentAnalyzedStartPushPayload = Effect.fn(
  "DeploymentRequests.decodeAnalyzedStartPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeAnalyzedStartPushRequestEffect(value);
});

export const decodeDeploymentFinishPushPayload = Effect.fn(
  "DeploymentRequests.decodeFinishPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<FinishPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeFinishPushRequestEffect(value);
});

export const decodeDeploymentAbandonPushPayload = Effect.fn(
  "DeploymentRequests.decodeAbandonPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AbandonPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeAbandonPushRequestEffect(value);
});

export const decodePublicStartPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicStartPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<StartPushRequest, DeploymentProtocolValidationError> {
  const request = yield* decodeStartPushRequestEffect(value);
  yield* requireFramedSourceModuleDigests(
    request.sourcePackage.sourceModuleDigestFormat,
  );
  return backendStartPushRequest(request);
});

export const decodePublicAnalyzedStartPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicAnalyzedStartPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  const request = yield* decodeDeploymentAnalyzedStartPushPayload(value);
  const sourcePackage = yield* decodePushSourcePackageEffect(
    request.sourcePackage,
  );
  yield* requireFramedSourceModuleDigests(
    sourcePackage.sourceModuleDigestFormat,
  );
  return request;
});

export const decodePublicFinishPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicFinishPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<FinishPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeDeploymentFinishPushPayload(value);
});

export const decodePublicAbandonPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicAbandonPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AbandonPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeDeploymentAbandonPushPayload(value);
});

function backendStartPushRequest(request: ProtocolStartPushRequest): StartPushRequest {
  return {
    sourcePackage: {
      modules: request.sourcePackage.modules.map(module => ({
        path: module.path,
        environment: module.environment,
        sha256: module.sha256,
        ...(module.source === undefined ? {} : { source: module.source }),
        ...(module.sourceMap === undefined ? {} : { sourceMap: module.sourceMap }),
      })),
      functions: [...request.sourcePackage.functions],
      ...(request.sourcePackage.sourceModuleDigestFormat === undefined
        ? {}
        : {
            sourceModuleDigestFormat:
              request.sourcePackage.sourceModuleDigestFormat,
          }),
      ...(request.sourcePackage.schema === undefined
        ? {}
        : { schema: request.sourcePackage.schema }),
      ...(request.sourcePackage.authConfig === undefined
        ? {}
        : { authConfig: request.sourcePackage.authConfig }),
      ...(request.sourcePackage.authConfigModule === undefined
        ? {}
        : { authConfigModule: request.sourcePackage.authConfigModule }),
      execution: request.sourcePackage.execution,
    },
  };
}

function requireFramedSourceModuleDigests(
  format: string | undefined,
): Effect.Effect<void, DeploymentProtocolValidationError> {
  return format === "sha256-framed-v1"
    ? Effect.void
    : Effect.fail(new DeploymentProtocolValidationError({
        schema: "PushSourcePackage",
        message:
          "New pushes require sha256-framed-v1 source-module digests.",
        cause: format,
      }));
}
