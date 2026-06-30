import { Effect } from "effect";
import {
  DeploymentProtocolValidationError,
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import {
  json,
  readJson,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
  type HttpError,
} from "../http";
import type { StartPushRequest } from "../types";
import {
  decodePublicAbandonPushPayload,
  decodePublicAnalyzedStartPushPayload,
  decodePublicFinishPushPayload,
  decodePublicStartPushPayload,
  parsePublicAbandonPushPayload,
  parsePublicAnalyzedStartPushPayload,
  parsePublicFinishPushPayload,
  parsePublicStartPushPayload,
} from "./Requests";

export async function readPublicStartPushJson(request: Request): Promise<unknown> {
  return await runPublicDeploymentJsonRequest(decodePublicStartPushJson(request));
}

export function decodePublicStartPushJson(request: Request): Effect.Effect<unknown, RequestJsonError> {
  return readJsonEffect(request);
}

export async function readPublicStartPushRequest(
  request: Request,
): Promise<StartPushRequest> {
  return await runPublicDeploymentRouteRequest(decodePublicStartPushRequest(request));
}

export function decodePublicStartPushRequest(
  request: Request,
): Effect.Effect<StartPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, parsePublicStartPushRequestEffect);
}

export function parsePublicStartPushRequest(body: unknown): StartPushRequest {
  return parsePublicStartPushPayload(body);
}

export function parsePublicStartPushRequestEffect(
  body: unknown,
): Effect.Effect<StartPushRequest, DeploymentProtocolValidationError> {
  return decodePublicStartPushPayload(body);
}

export async function readPublicAnalyzedStartPushRequest(
  request: Request,
): Promise<AnalyzedStartPushRequest> {
  return await runPublicDeploymentRouteRequest(decodePublicAnalyzedStartPushRequest(request));
}

export function decodePublicAnalyzedStartPushRequest(
  request: Request,
): Effect.Effect<AnalyzedStartPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, parsePublicAnalyzedStartPushRequestEffect);
}

export function parsePublicAnalyzedStartPushRequest(
  body: unknown,
): AnalyzedStartPushRequest {
  return parsePublicAnalyzedStartPushPayload(body);
}

export function parsePublicAnalyzedStartPushRequestEffect(
  body: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return decodePublicAnalyzedStartPushPayload(body);
}

export async function readPublicFinishPushRequest(
  request: Request,
): Promise<FinishPushRequest> {
  return await runPublicDeploymentRouteRequest(decodePublicFinishPushRequest(request));
}

export function decodePublicFinishPushRequest(
  request: Request,
): Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, parsePublicFinishPushRequestEffect);
}

export async function readPublicFinishPushJson(request: Request): Promise<unknown> {
  return await runPublicDeploymentJsonRequest(decodePublicFinishPushJson(request));
}

export function decodePublicFinishPushJson(request: Request): Effect.Effect<unknown, RequestJsonError> {
  return readJsonEffect(request);
}

export function parsePublicFinishPushRequest(
  body: unknown,
): FinishPushRequest {
  return parsePublicFinishPushPayload(body);
}

export function parsePublicFinishPushRequestEffect(
  body: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return decodePublicFinishPushPayload(body);
}

export async function readPublicAbandonPushRequest(
  request: Request,
): Promise<AbandonPushRequest> {
  return await runPublicDeploymentRouteRequest(decodePublicAbandonPushRequest(request));
}

export function decodePublicAbandonPushRequest(
  request: Request,
): Effect.Effect<AbandonPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodePublicDeploymentRouteRequest(request, parsePublicAbandonPushRequestEffect);
}

export function parsePublicAbandonPushRequest(
  body: unknown,
): AbandonPushRequest {
  return parsePublicAbandonPushPayload(body);
}

export function parsePublicAbandonPushRequestEffect(
  body: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return decodePublicAbandonPushPayload(body);
}

async function runPublicDeploymentRouteRequest<A>(
  effect: Effect.Effect<A, RequestJsonError | DeploymentProtocolValidationError>,
): Promise<A> {
  return await Effect.runPromise(
    effect.pipe(
      Effect.mapError(publicDeploymentRouteErrorToHttpError),
    ),
  );
}

async function runPublicDeploymentJsonRequest(
  effect: Effect.Effect<unknown, RequestJsonError>,
): Promise<unknown> {
  return await Effect.runPromise(
    effect.pipe(
      Effect.mapError(requestJsonErrorToHttpError),
    ),
  );
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
  error: RequestJsonError | DeploymentProtocolValidationError,
): HttpError | DeploymentProtocolValidationError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return error;
}

export function deploymentProtocolValidationErrorResponse(
  error: unknown,
): Response | undefined {
  if (!(error instanceof DeploymentProtocolValidationError)) {
    return undefined;
  }
  return json({ error: error.message }, { status: 400 });
}
