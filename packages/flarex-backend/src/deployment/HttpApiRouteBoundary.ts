import { Effect } from "effect";
import {
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  DeploymentPushAction,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  type FinishPushRequest,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
} from "flarex-protocol/deployment";
import {
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
  type HttpError,
} from "../http";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

export async function deploymentApiRequestForRoute(request: Request): Promise<Request | null> {
  return await Effect.runPromise(
    decodeDeploymentApiRequestForRoute(request).pipe(
      Effect.mapError(deploymentRouteErrorToHttpError),
    ),
  );
}

export const decodeDeploymentApiRequestForRoute = Effect.fn("DeploymentDO.decodeApiRequestForRoute")(
  function* (request: Request) {
    const url = new URL(request.url);
    if (isDeploymentApiReadRoute(request, url)) {
      return request;
    }
    if (url.pathname === DeploymentRoute.startAnalyzedPush && request.method === "POST") {
      const body = yield* decodeDeploymentAnalyzedStartPushRouteRequest(request);
      return jsonRequest(url, body);
    }

    const pushMatch = url.pathname.match(deploymentPushRoutePattern);
    if (pushMatch === null) {
      return null;
    }
    const action = pushMatch[2];
    if (action === DeploymentPushAction.finish && request.method === "POST") {
      const body = yield* decodeDeploymentFinishPushRouteRequest(request);
      return jsonRequest(url, body);
    }
    if (action === DeploymentPushAction.abandon && request.method === "POST") {
      const body = yield* decodeDeploymentAbandonPushRouteRequest(request);
      return jsonRequest(url, body);
    }
    return null;
  },
);

export async function readDeploymentAnalyzedStartPushRouteRequest(
  request: Request,
): Promise<AnalyzedStartPushRequest> {
  return await runDeploymentRouteRequest(decodeDeploymentAnalyzedStartPushRouteRequest(request));
}

export function decodeDeploymentAnalyzedStartPushRouteRequest(
  request: Request,
): Effect.Effect<AnalyzedStartPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodeDeploymentRouteRequest(request, parseDeploymentAnalyzedStartPushRouteRequestEffect);
}

export function parseDeploymentAnalyzedStartPushRouteRequest(
  value: unknown,
): AnalyzedStartPushRequest {
  return parseAnalyzedStartPushRequest(value);
}

export function parseDeploymentAnalyzedStartPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return parseDeploymentProtocolRequestEffect(value, parseDeploymentAnalyzedStartPushRouteRequest);
}

export async function readDeploymentFinishPushRouteRequest(
  request: Request,
): Promise<FinishPushRequest> {
  return await runDeploymentRouteRequest(decodeDeploymentFinishPushRouteRequest(request));
}

export function decodeDeploymentFinishPushRouteRequest(
  request: Request,
): Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodeDeploymentRouteRequest(request, parseDeploymentFinishPushRouteRequestEffect);
}

export function parseDeploymentFinishPushRouteRequest(
  value: unknown,
): FinishPushRequest {
  return parseFinishPushRequest(value);
}

export function parseDeploymentFinishPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return parseDeploymentProtocolRequestEffect(value, parseDeploymentFinishPushRouteRequest);
}

export function deploymentRouteErrorToHttpError(
  error: RequestJsonError | DeploymentProtocolValidationError,
): HttpError | DeploymentProtocolValidationError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return error;
}

export async function readDeploymentAbandonPushRouteRequest(
  request: Request,
): Promise<AbandonPushRequest> {
  return await runDeploymentRouteRequest(decodeDeploymentAbandonPushRouteRequest(request));
}

export function decodeDeploymentAbandonPushRouteRequest(
  request: Request,
): Effect.Effect<AbandonPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return decodeDeploymentRouteRequest(request, parseDeploymentAbandonPushRouteRequestEffect);
}

export function parseDeploymentAbandonPushRouteRequest(
  value: unknown,
): AbandonPushRequest {
  return parseAbandonPushRequest(value);
}

export function parseDeploymentAbandonPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return parseDeploymentProtocolRequestEffect(value, parseDeploymentAbandonPushRouteRequest);
}

async function runDeploymentRouteRequest<A>(
  effect: Effect.Effect<A, RequestJsonError | DeploymentProtocolValidationError>,
): Promise<A> {
  return await Effect.runPromise(
    effect.pipe(
      Effect.mapError(deploymentRouteErrorToHttpError),
    ),
  );
}

function decodeDeploymentRouteRequest<A>(
  request: Request,
  parse: (value: unknown) => Effect.Effect<A, DeploymentProtocolValidationError>,
): Effect.Effect<A, RequestJsonError | DeploymentProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parse),
  );
}

function parseDeploymentProtocolRequestEffect<A>(
  value: unknown,
  parse: (value: unknown) => A,
): Effect.Effect<A, DeploymentProtocolValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(parse(value));
    } catch (error) {
      if (error instanceof DeploymentProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

function jsonRequest(url: URL, body: unknown): Request {
  return new Request(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isDeploymentApiReadRoute(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (url.pathname === DeploymentRoute.health || url.pathname === DeploymentRoute.activeDeployment) {
    return true;
  }
  const pushMatch = url.pathname.match(deploymentPushRoutePattern);
  return pushMatch !== null && pushMatch[2] === undefined;
}
