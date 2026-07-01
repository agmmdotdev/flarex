import { Effect } from "effect";
import {
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  DeploymentPushAction,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  decodeDeploymentAbandonPushPayload,
  decodeDeploymentAnalyzedStartPushPayload,
  decodeDeploymentFinishPushPayload,
} from "./Requests";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

export type DeploymentRouteError = RequestJsonError | DeploymentProtocolValidationError;

export async function deploymentApiRequestForRoute(request: Request): Promise<Request | null> {
  return await Effect.runPromise(
    decodeDeploymentApiRequestForRoute(request).pipe(
      Effect.catch(deploymentRouteErrorToHttpErrorEffect),
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
): Effect.Effect<AnalyzedStartPushRequest, DeploymentRouteError> {
  return decodeDeploymentRouteRequest(request, decodeDeploymentAnalyzedStartPushRoutePayload);
}

export function parseDeploymentAnalyzedStartPushRouteRequest(
  value: unknown,
): AnalyzedStartPushRequest {
  return Effect.runSync(parseDeploymentAnalyzedStartPushRouteRequestEffect(value).pipe(
    Effect.catch(deploymentRouteErrorToHttpErrorEffect),
  ));
}

export function parseDeploymentAnalyzedStartPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentAnalyzedStartPushRoutePayload(value);
}

export function decodeDeploymentAnalyzedStartPushRoutePayload(
  value: unknown,
): Effect.Effect<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentAnalyzedStartPushPayload(value);
}

export async function readDeploymentFinishPushRouteRequest(
  request: Request,
): Promise<FinishPushRequest> {
  return await runDeploymentRouteRequest(decodeDeploymentFinishPushRouteRequest(request));
}

export function decodeDeploymentFinishPushRouteRequest(
  request: Request,
): Effect.Effect<FinishPushRequest, DeploymentRouteError> {
  return decodeDeploymentRouteRequest(request, decodeDeploymentFinishPushRoutePayload);
}

export function parseDeploymentFinishPushRouteRequest(
  value: unknown,
): FinishPushRequest {
  return Effect.runSync(parseDeploymentFinishPushRouteRequestEffect(value).pipe(
    Effect.catch(deploymentRouteErrorToHttpErrorEffect),
  ));
}

export function parseDeploymentFinishPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentFinishPushRoutePayload(value);
}

export function decodeDeploymentFinishPushRoutePayload(
  value: unknown,
): Effect.Effect<FinishPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentFinishPushPayload(value);
}

export function deploymentRouteErrorToHttpError(
  error: DeploymentRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const deploymentRouteErrorToHttpErrorEffect = Effect.fn(
  "DeploymentHttpApiRouteBoundary.deploymentRouteErrorToHttpError",
)(function* (
  error: DeploymentRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(deploymentRouteErrorToHttpError(error));
});

export async function readDeploymentAbandonPushRouteRequest(
  request: Request,
): Promise<AbandonPushRequest> {
  return await runDeploymentRouteRequest(decodeDeploymentAbandonPushRouteRequest(request));
}

export function decodeDeploymentAbandonPushRouteRequest(
  request: Request,
): Effect.Effect<AbandonPushRequest, DeploymentRouteError> {
  return decodeDeploymentRouteRequest(request, decodeDeploymentAbandonPushRoutePayload);
}

export function parseDeploymentAbandonPushRouteRequest(
  value: unknown,
): AbandonPushRequest {
  return Effect.runSync(parseDeploymentAbandonPushRouteRequestEffect(value).pipe(
    Effect.catch(deploymentRouteErrorToHttpErrorEffect),
  ));
}

export function parseDeploymentAbandonPushRouteRequestEffect(
  value: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentAbandonPushRoutePayload(value);
}

export function decodeDeploymentAbandonPushRoutePayload(
  value: unknown,
): Effect.Effect<AbandonPushRequest, DeploymentProtocolValidationError> {
  return decodeDeploymentAbandonPushPayload(value);
}

async function runDeploymentRouteRequest<A>(
  effect: Effect.Effect<A, DeploymentRouteError>,
): Promise<A> {
  return await Effect.runPromise(
    effect.pipe(
      Effect.catch(deploymentRouteErrorToHttpErrorEffect),
    ),
  );
}

function decodeDeploymentRouteRequest<A>(
  request: Request,
  parse: (value: unknown) => Effect.Effect<A, DeploymentProtocolValidationError>,
): Effect.Effect<A, DeploymentRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parse),
  );
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
