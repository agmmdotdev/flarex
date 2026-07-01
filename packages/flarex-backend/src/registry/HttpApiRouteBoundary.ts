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

export type RegistryApiRouteInput =
  | {
    readonly _tag: "RegistryApiHealthRoute";
    readonly request: Request;
  }
  | {
    readonly _tag: "RegistryApiListDeploymentsRoute";
    readonly request: Request;
  }
  | {
    readonly _tag: "RegistryApiCreateDeploymentRoute";
    readonly url: URL;
    readonly body: CreateDeploymentRequest;
  };

export const decodeRegistryApiRouteInput = Effect.fn("RegistryDO.decodeApiRouteInput")(
  function* (request: Request): Effect.fn.Return<RegistryApiRouteInput | null, RegistryRouteError> {
    const url = new URL(request.url);
    if (url.pathname === RegistryRoute.health && request.method === "GET") {
      return {
        _tag: "RegistryApiHealthRoute",
        request,
      };
    }
    if (url.pathname === RegistryRoute.deployments && request.method === "GET") {
      return {
        _tag: "RegistryApiListDeploymentsRoute",
        request,
      };
    }
    if (url.pathname === RegistryRoute.deployments && request.method === "POST") {
      const body = yield* decodeRegistryCreateDeploymentRouteRequest(request);
      return {
        _tag: "RegistryApiCreateDeploymentRoute",
        url,
        body,
      };
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
