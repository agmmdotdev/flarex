import { Data, Effect } from "effect";
import {
  DeploymentProtocolValidationError,
  DeploymentRoute,
} from "flarex-protocol/deployment";
import { errorResponse, HttpError, json } from "../http";
import {
  decodeDeploymentApiRequestForRoute,
  deploymentRouteErrorToHttpError,
  type DeploymentRouteError,
} from "./HttpApiRouteBoundary";

export class DeploymentRouteOperationError extends Data.TaggedError(
  "DeploymentRouteOperationError",
)<{
  readonly operation: "http-api";
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type DeploymentInternalRouteError =
  | DeploymentRouteError
  | DeploymentRouteOperationError;

export const routeDeploymentDurableObject = Effect.fn("DeploymentDO.route")(
  function* (
    request: Request,
    handleApiRequest: (request: Request) => Promise<Response>,
  ): Effect.fn.Return<Response, DeploymentInternalRouteError> {
    const url = new URL(request.url);
    const apiRequest = yield* decodeDeploymentApiRequestForRoute(request);
    if (apiRequest !== null) {
      return yield* Effect.tryPromise({
        try: () => handleApiRequest(apiRequest),
        catch: cause =>
          cause instanceof DeploymentProtocolValidationError
            ? cause
            : deploymentRouteOperationError("http-api", cause),
      });
    }
    if (url.pathname === DeploymentRoute.health) {
      return json({ service: "flarex-deployment", status: "ok" });
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

export function runDeploymentDurableObjectRoute(
  effect: Effect.Effect<Response, DeploymentInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(deploymentInternalRouteErrorToResponseEffect),
    ),
  );
}

export function deploymentInternalRouteErrorToResponse(
  error: DeploymentInternalRouteError,
): Response {
  if (error instanceof DeploymentRouteOperationError) {
    return errorResponse(new HttpError(error.status, error.message));
  }
  return errorResponse(deploymentRouteErrorToHttpError(error));
}

export const deploymentInternalRouteErrorToResponseEffect = Effect.fn(
  "DeploymentInternalRouteBoundary.deploymentInternalRouteErrorToResponse",
)(function* (
  error: DeploymentInternalRouteError,
): Effect.fn.Return<Response> {
  return yield* Effect.succeed(deploymentInternalRouteErrorToResponse(error));
});

function deploymentRouteOperationError(
  operation: DeploymentRouteOperationError["operation"],
  cause: unknown,
): DeploymentRouteOperationError {
  return new DeploymentRouteOperationError({
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
