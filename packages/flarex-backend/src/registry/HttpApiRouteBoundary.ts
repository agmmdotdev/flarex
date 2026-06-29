import { Effect } from "effect";
import {
  parseCreateDeploymentRequest,
  ProtocolValidationError,
  RegistryRoute,
  type CreateDeploymentRequest,
} from "flarex-protocol/registry";
import {
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
  type HttpError,
} from "../http";

export async function registryApiRequestForRoute(request: Request): Promise<Request | null> {
  return await Effect.runPromise(
    decodeRegistryApiRequestForRoute(request).pipe(
      Effect.mapError(registryRouteErrorToHttpError),
    ),
  );
}

export const decodeRegistryApiRequestForRoute = Effect.fn("RegistryDO.decodeApiRequestForRoute")(
  function* (request: Request) {
    const url = new URL(request.url);
    if (isRegistryApiReadRoute(request, url)) {
      return request;
    }
    if (url.pathname === RegistryRoute.deployments && request.method === "POST") {
      const body = yield* decodeRegistryCreateDeploymentRouteRequest(request);
      return jsonRequest(url, body);
    }
    return null;
  },
);

export async function readRegistryCreateDeploymentRouteRequest(
  request: Request,
): Promise<CreateDeploymentRequest> {
  return await Effect.runPromise(
    decodeRegistryCreateDeploymentRouteRequest(request).pipe(
      Effect.mapError(registryRouteErrorToHttpError),
    ),
  );
}

export function decodeRegistryCreateDeploymentRouteRequest(
  request: Request,
): Effect.Effect<CreateDeploymentRequest, RequestJsonError | ProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseRegistryCreateDeploymentRouteRequestEffect),
  );
}

export function parseRegistryCreateDeploymentRouteRequest(
  value: unknown,
): CreateDeploymentRequest {
  return parseCreateDeploymentRequest(value);
}

export function parseRegistryCreateDeploymentRouteRequestEffect(
  value: unknown,
): Effect.Effect<CreateDeploymentRequest, ProtocolValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(parseRegistryCreateDeploymentRouteRequest(value));
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

export function registryRouteErrorToHttpError(
  error: RequestJsonError | ProtocolValidationError,
): HttpError | ProtocolValidationError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return error;
}

function jsonRequest(url: URL, body: unknown): Request {
  return new Request(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isRegistryApiReadRoute(request: Request, url: URL): boolean {
  return request.method === "GET" && (
    url.pathname === RegistryRoute.health
      || url.pathname === RegistryRoute.deployments
  );
}
