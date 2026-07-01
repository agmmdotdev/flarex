import { Effect } from "effect";
import {
  ProtocolValidationError,
  RegistryRoute,
  RegistryStorageErrorResponse,
} from "flarex-protocol/registry";
import { errorResponse, json } from "../http";
import {
  registryCreateDeploymentHandler,
  registryHealthHandler,
  registryListDeploymentsHandler,
} from "./HttpApiHandlers";
import {
  decodeRegistryApiRouteInput,
  registryRouteErrorToHttpError,
  type RegistryApiRouteInput,
  type RegistryRouteError,
} from "./HttpApiRouteBoundary";
import { RegistryService, type RegistryServiceApi } from "./Service";

export type RegistryInternalRouteError = RegistryRouteError;

export const routeRegistryDurableObject = Effect.fn("RegistryDO.route")(
  function* (
    request: Request,
  ): Effect.fn.Return<Response, RegistryInternalRouteError, RegistryService> {
    const url = new URL(request.url);
    const apiRouteInput = yield* decodeRegistryApiRouteInput(request);
    if (apiRouteInput !== null) {
      const registry = yield* RegistryService;
      return yield* dispatchRegistryApiRouteInputDirect(apiRouteInput, registry);
    }
    if (url.pathname === RegistryRoute.health) {
      return json({ service: "flarex-registry", status: "ok" });
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

export const dispatchRegistryApiRouteInputDirect = Effect.fn(
  "RegistryDO.dispatchApiRouteInputDirect",
)(function* (
  apiRouteInput: RegistryApiRouteInput,
  registry: RegistryServiceApi,
): Effect.fn.Return<Response> {
  if (apiRouteInput._tag === "RegistryApiHealthRoute") {
    return yield* registryHealthHandler().pipe(
      Effect.match({
        onFailure: registryGeneratedValueToResponse,
        onSuccess: registryGeneratedValueToResponse,
      }),
    );
  }
  if (apiRouteInput._tag === "RegistryApiListDeploymentsRoute") {
    return yield* registryListDeploymentsHandler(registry).pipe(
      Effect.match({
        onFailure: registryGeneratedValueToResponse,
        onSuccess: registryGeneratedValueToResponse,
      }),
    );
  }
  return yield* registryCreateDeploymentHandler(registry, apiRouteInput.body).pipe(
    Effect.match({
      onFailure: registryGeneratedValueToResponse,
      onSuccess: registryGeneratedValueToResponse,
    }),
  );
});

export function runRegistryDurableObjectRoute(
  effect: Effect.Effect<Response, RegistryInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(registryInternalRouteErrorToResponseEffect),
    ),
  );
}

export function registryInternalRouteErrorToResponse(
  error: RegistryInternalRouteError,
): Response {
  const httpError = registryRouteErrorToHttpError(error);
  if (httpError instanceof ProtocolValidationError) {
    return json({ error: httpError.message }, { status: 400 });
  }
  return errorResponse(httpError);
}

export const registryInternalRouteErrorToResponseEffect = Effect.fn(
  "RegistryInternalRouteBoundary.registryInternalRouteErrorToResponse",
)(function* (
  error: RegistryInternalRouteError,
): Effect.fn.Return<Response> {
  return yield* Effect.succeed(registryInternalRouteErrorToResponse(error));
});

function registryGeneratedValueToResponse(value: object): Response {
  if (value instanceof RegistryStorageErrorResponse) {
    return json(value, { status: 500 });
  }
  return json(value);
}
