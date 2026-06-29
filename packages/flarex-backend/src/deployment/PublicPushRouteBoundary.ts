import { Effect } from "effect";
import {
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
  parseStartPushRequest,
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

export async function readPublicStartPushJson(request: Request): Promise<unknown> {
  return await runPublicDeploymentJsonRequest(readJsonEffect(request));
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
  const request = parseStartPushRequest(body);
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
      ...(request.sourcePackage.schema === undefined ? {} : { schema: request.sourcePackage.schema }),
      execution: request.sourcePackage.execution,
    },
  };
}

export function parsePublicStartPushRequestEffect(
  body: unknown,
): Effect.Effect<StartPushRequest, DeploymentProtocolValidationError> {
  return parsePublicDeploymentProtocolRequestEffect(body, parsePublicStartPushRequest);
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
  return parseAnalyzedStartPushRequest(body);
}

export function parsePublicAnalyzedStartPushRequestEffect(
  body: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return parsePublicDeploymentProtocolRequestEffect(body, parsePublicAnalyzedStartPushRequest);
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
  return await runPublicDeploymentJsonRequest(readJsonEffect(request));
}

export function parsePublicFinishPushRequest(
  body: unknown,
): FinishPushRequest {
  return parseFinishPushRequest(body);
}

export function parsePublicFinishPushRequestEffect(
  body: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return parsePublicDeploymentProtocolRequestEffect(body, parsePublicFinishPushRequest);
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
  return parseAbandonPushRequest(body);
}

export function parsePublicAbandonPushRequestEffect(
  body: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return parsePublicDeploymentProtocolRequestEffect(body, parsePublicAbandonPushRequest);
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

function parsePublicDeploymentProtocolRequestEffect<A>(
  body: unknown,
  parse: (body: unknown) => A,
): Effect.Effect<A, DeploymentProtocolValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(parse(body));
    } catch (error) {
      if (error instanceof DeploymentProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
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
