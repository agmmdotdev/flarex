import { Effect } from "effect";
import {
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
import { decodeRegistryCreateDeploymentPayload } from "./Requests";

export type RegistryRouteError = RequestJsonError | ProtocolValidationError;

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

export function decodeRegistryCreateDeploymentRouteRequest(
  request: Request,
): Effect.Effect<CreateDeploymentRequest, RegistryRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeRegistryCreateDeploymentPayload),
  );
}

export function registryRouteErrorToHttpError(
  error: RegistryRouteError,
): HttpError | ProtocolValidationError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return error;
}

export const registryRouteErrorToHttpErrorEffect = Effect.fn(
  "RegistryHttpApiRouteBoundary.registryRouteErrorToHttpError",
)(function* (
  error: RegistryRouteError,
): Effect.fn.Return<never, HttpError | ProtocolValidationError> {
  return yield* Effect.fail(registryRouteErrorToHttpError(error));
});

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
