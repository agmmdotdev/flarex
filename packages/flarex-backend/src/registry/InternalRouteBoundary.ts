import { Data, Effect } from "effect";
import {
  ProtocolValidationError,
  RegistryRoute,
} from "flarex-protocol/registry";
import { errorResponse, HttpError, json, RequestJsonError } from "../http";
import {
  decodeRegistryApiRequestForRoute,
  registryRouteErrorToHttpError,
} from "./HttpApiRouteBoundary";

export class RegistryRouteOperationError extends Data.TaggedError(
  "RegistryRouteOperationError",
)<{
  readonly operation: "http-api";
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type RegistryInternalRouteError =
  | RequestJsonError
  | ProtocolValidationError
  | RegistryRouteOperationError;

export const routeRegistryDurableObject = Effect.fn("RegistryDO.route")(
  function* (
    request: Request,
    handleApiRequest: (request: Request) => Promise<Response>,
  ): Effect.fn.Return<Response, RegistryInternalRouteError> {
    const url = new URL(request.url);
    const apiRequest = yield* decodeRegistryApiRequestForRoute(request);
    if (apiRequest !== null) {
      return yield* Effect.tryPromise({
        try: () => handleApiRequest(apiRequest),
        catch: cause =>
          cause instanceof ProtocolValidationError
            ? cause
            : registryRouteOperationError("http-api", cause),
      });
    }
    if (url.pathname === RegistryRoute.health) {
      return json({ service: "flarex-registry", status: "ok" });
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

export function runRegistryDurableObjectRoute(
  effect: Effect.Effect<Response, RegistryInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catchTags({
        RequestJsonError: error =>
          Effect.succeed(registryInternalRouteErrorToResponse(error)),
        ProtocolValidationError: error =>
          Effect.succeed(registryInternalRouteErrorToResponse(error)),
        RegistryRouteOperationError: error =>
          Effect.succeed(registryInternalRouteErrorToResponse(error)),
      }),
    ),
  );
}

export function registryInternalRouteErrorToResponse(
  error: RegistryInternalRouteError,
): Response {
  if (error instanceof RegistryRouteOperationError) {
    return errorResponse(new HttpError(error.status, error.message));
  }
  const httpError = registryRouteErrorToHttpError(error);
  if (httpError instanceof ProtocolValidationError) {
    return json({ error: httpError.message }, { status: 400 });
  }
  return errorResponse(httpError);
}

function registryRouteOperationError(
  operation: RegistryRouteOperationError["operation"],
  cause: unknown,
): RegistryRouteOperationError {
  return new RegistryRouteOperationError({
    operation,
    status: cause instanceof HttpError ? cause.status : 500,
    message: errorMessage(cause),
    cause,
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
