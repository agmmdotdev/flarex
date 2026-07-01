import { Effect } from "effect";
import {
  decodeAbandonPushRequestEffect,
  decodeAnalyzedStartPushRequestEffect,
  decodeFinishPushRequestEffect,
  decodeStartPushRequestEffect,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
  parseStartPushRequest,
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

export function parseDeploymentAnalyzedStartPushPayload(
  value: unknown,
): AnalyzedStartPushRequest {
  return parseAnalyzedStartPushRequest(value);
}

export const decodeDeploymentFinishPushPayload = Effect.fn(
  "DeploymentRequests.decodeFinishPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<FinishPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeFinishPushRequestEffect(value);
});

export function parseDeploymentFinishPushPayload(value: unknown): FinishPushRequest {
  return parseFinishPushRequest(value);
}

export const decodeDeploymentAbandonPushPayload = Effect.fn(
  "DeploymentRequests.decodeAbandonPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AbandonPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeAbandonPushRequestEffect(value);
});

export function parseDeploymentAbandonPushPayload(value: unknown): AbandonPushRequest {
  return parseAbandonPushRequest(value);
}

export const decodePublicStartPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicStartPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<StartPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeStartPushRequestEffect(value).pipe(
    Effect.map(backendStartPushRequest),
  );
});

export function parsePublicStartPushPayload(value: unknown): StartPushRequest {
  return backendStartPushRequest(parseStartPushRequest(value));
}

export const decodePublicAnalyzedStartPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicAnalyzedStartPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeDeploymentAnalyzedStartPushPayload(value);
});

export function parsePublicAnalyzedStartPushPayload(value: unknown): AnalyzedStartPushRequest {
  return parseDeploymentAnalyzedStartPushPayload(value);
}

export const decodePublicFinishPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicFinishPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<FinishPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeDeploymentFinishPushPayload(value);
});

export function parsePublicFinishPushPayload(value: unknown): FinishPushRequest {
  return parseDeploymentFinishPushPayload(value);
}

export const decodePublicAbandonPushPayload = Effect.fn(
  "DeploymentRequests.decodePublicAbandonPushPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<AbandonPushRequest, DeploymentProtocolValidationError> {
  return yield* decodeDeploymentAbandonPushPayload(value);
});

export function parsePublicAbandonPushPayload(value: unknown): AbandonPushRequest {
  return parseDeploymentAbandonPushPayload(value);
}

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
      ...(request.sourcePackage.schema === undefined
        ? {}
        : { schema: request.sourcePackage.schema }),
      execution: request.sourcePackage.execution,
    },
  };
}
