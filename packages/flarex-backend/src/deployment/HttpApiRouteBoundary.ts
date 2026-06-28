import { Effect } from "effect";
import {
  type AbandonPushRequest,
  DeploymentPushAction,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  type FinishPushRequest,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseFinishPushRequest,
} from "flarex-protocol/deployment";
import {
  readJson,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
  type HttpError,
} from "../http";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

export async function deploymentApiRequestForRoute(request: Request): Promise<Request | null> {
  const url = new URL(request.url);
  if (isDeploymentApiReadRoute(request, url)) {
    return request;
  }
  if (url.pathname === DeploymentRoute.startAnalyzedPush && request.method === "POST") {
    return jsonRequest(url, parseAnalyzedStartPushRequest(await readJson(request)));
  }

  const pushMatch = url.pathname.match(deploymentPushRoutePattern);
  if (pushMatch === null) {
    return null;
  }
  const action = pushMatch[2];
  if (action === DeploymentPushAction.finish && request.method === "POST") {
    return jsonRequest(url, await readDeploymentFinishPushRouteRequest(request));
  }
  if (action === DeploymentPushAction.abandon && request.method === "POST") {
    return jsonRequest(url, await readDeploymentAbandonPushRouteRequest(request));
  }
  return null;
}

export async function readDeploymentFinishPushRouteRequest(
  request: Request,
): Promise<FinishPushRequest> {
  return await Effect.runPromise(
    decodeDeploymentFinishPushRouteRequest(request).pipe(
      Effect.mapError(deploymentFinishRouteErrorToHttpError),
    ),
  );
}

export function decodeDeploymentFinishPushRouteRequest(
  request: Request,
): Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseDeploymentFinishPushRouteRequestEffect),
  );
}

export function parseDeploymentFinishPushRouteRequest(
  value: unknown,
): FinishPushRequest {
  return parseFinishPushRequest(value);
}

export function parseDeploymentFinishPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(parseDeploymentFinishPushRouteRequest(value));
    } catch (error) {
      if (error instanceof DeploymentProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

function deploymentFinishRouteErrorToHttpError(
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
  return parseDeploymentAbandonPushRouteRequest(await readJson(request));
}

export function parseDeploymentAbandonPushRouteRequest(
  value: unknown,
): AbandonPushRequest {
  return parseAbandonPushRequest(value);
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
