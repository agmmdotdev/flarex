import { Effect } from "effect";
import {
  DeploymentProtocolValidationError,
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { StartPushRequest } from "../types";
import {
  decodePublicAbandonPushPayload,
  decodePublicAnalyzedStartPushPayload,
  decodePublicFinishPushPayload,
  decodePublicStartPushPayload,
} from "./Requests";

export type PublicDeploymentRouteError =
  | RequestJsonError
  | DeploymentProtocolValidationError;

export function decodePublicStartPushJson(request: Request): Effect.Effect<unknown, RequestJsonError> {
  return readJsonEffect(request);
}

export function decodePublicStartPushRequest(
  request: Request,
): Effect.Effect<StartPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, decodePublicStartPushRoutePayload);
}

export function decodePublicStartPushRoutePayload(
  body: unknown,
): Effect.Effect<StartPushRequest, DeploymentProtocolValidationError> {
  return decodePublicStartPushPayload(body);
}

export function decodePublicAnalyzedStartPushRequest(
  request: Request,
): Effect.Effect<AnalyzedStartPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, decodePublicAnalyzedStartPushRoutePayload);
}

export function decodePublicAnalyzedStartPushRoutePayload(
  body: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return decodePublicAnalyzedStartPushPayload(body);
}

export function decodePublicFinishPushRequest(
  request: Request,
): Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, decodePublicFinishPushRoutePayload);
}

export function decodePublicFinishPushJson(request: Request): Effect.Effect<unknown, RequestJsonError> {
  return readJsonEffect(request);
}

export function decodePublicFinishPushRoutePayload(
  body: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return decodePublicFinishPushPayload(body);
}

export function decodePublicAbandonPushRequest(
  request: Request,
): Effect.Effect<AbandonPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, decodePublicAbandonPushRoutePayload);
}

export function decodePublicAbandonPushRoutePayload(
  body: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return decodePublicAbandonPushPayload(body);
}

function decodePublicDeploymentRouteRequest<A>(
  request: Request,
  parse: (body: unknown) => Effect.Effect<A, DeploymentProtocolValidationError>,
): Effect.Effect<A, RequestJsonError | DeploymentProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parse),
  );
}

export function publicDeploymentRouteErrorToHttpError(
  error: PublicDeploymentRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const publicDeploymentRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicPushRouteBoundary.publicDeploymentRouteErrorToHttpError",
)(function* (
  error: PublicDeploymentRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(publicDeploymentRouteErrorToHttpError(error));
});
