import { Data, Effect } from "effect";
import {
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  DeploymentStorageErrorResponse,
} from "flarex-protocol/deployment";
import { errorResponse, HttpError, json } from "../http";
import {
  deploymentAbandonPushHandler,
  deploymentFinishPushHandler,
  deploymentStartAnalyzedPushHandler,
} from "./HttpApiHandlers";
import {
  decodeDeploymentApiRouteInput,
  deploymentApiRouteInputToRequest,
  deploymentRouteErrorToHttpError,
  type DeploymentApiRouteInput,
  type DeploymentRouteError,
} from "./HttpApiRouteBoundary";
import type { DeploymentServiceApi } from "./Service";

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

export type DeploymentApiMutationRouteInput = Extract<
  DeploymentApiRouteInput,
  | { readonly _tag: "DeploymentApiStartAnalyzedPushRoute" }
  | { readonly _tag: "DeploymentApiFinishPushRoute" }
  | { readonly _tag: "DeploymentApiAbandonPushRoute" }
>;

export const routeDeploymentDurableObject = Effect.fn("DeploymentDO.route")(
  function* (
    request: Request,
    handleApiRequest: (request: Request) => Promise<Response>,
  ): Effect.fn.Return<Response, DeploymentInternalRouteError> {
    const url = new URL(request.url);
    const apiRouteInput = yield* decodeDeploymentApiRouteInput(request);
    if (apiRouteInput !== null) {
      return yield* dispatchDeploymentApiRouteInputViaRequestCompatibility(
        apiRouteInput,
        handleApiRequest,
      );
    }
    if (url.pathname === DeploymentRoute.health) {
      return json({ service: "flarex-deployment", status: "ok" });
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

export const dispatchDeploymentApiRouteInputViaRequestCompatibility = Effect.fn(
  "DeploymentDO.dispatchApiRouteInputViaRequestCompatibility",
)(function* (
  apiRouteInput: DeploymentApiRouteInput,
  handleApiRequest: (request: Request) => Promise<Response>,
): Effect.fn.Return<Response, DeploymentRouteOperationError | DeploymentProtocolValidationError> {
  const apiRequest = deploymentApiRouteInputToRequest(apiRouteInput);
  return yield* Effect.tryPromise({
    try: () => handleApiRequest(apiRequest),
    catch: cause =>
      cause instanceof DeploymentProtocolValidationError
        ? cause
        : deploymentRouteOperationError("http-api", cause),
  });
});

export const dispatchDeploymentApiMutationRouteInputDirect = Effect.fn(
  "DeploymentDO.dispatchApiMutationRouteInputDirect",
)(function* (
  apiRouteInput: DeploymentApiMutationRouteInput,
  deployment: DeploymentServiceApi,
): Effect.fn.Return<Response> {
  if (apiRouteInput._tag === "DeploymentApiStartAnalyzedPushRoute") {
    return yield* deploymentStartAnalyzedPushHandler(deployment, apiRouteInput.body).pipe(
      Effect.match({
        onFailure: deploymentGeneratedMutationValueToResponse,
        onSuccess: deploymentGeneratedMutationValueToResponse,
      }),
    );
  }
  if (apiRouteInput._tag === "DeploymentApiFinishPushRoute") {
    return yield* deploymentFinishPushHandler(deployment, apiRouteInput.pushId).pipe(
      Effect.match({
        onFailure: deploymentGeneratedMutationValueToResponse,
        onSuccess: deploymentGeneratedMutationValueToResponse,
      }),
    );
  }
  return yield* deploymentAbandonPushHandler(deployment, apiRouteInput.pushId, apiRouteInput.body).pipe(
    Effect.match({
      onFailure: deploymentGeneratedMutationValueToResponse,
      onSuccess: deploymentGeneratedMutationValueToResponse,
    }),
  );
});

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

function deploymentGeneratedMutationValueToResponse(value: object): Response {
  if (value instanceof DeploymentBadRequestErrorResponse) {
    return json(value, { status: 400 });
  }
  if (value instanceof DeploymentNotFoundErrorResponse) {
    return json(value, { status: 404 });
  }
  if (value instanceof DeploymentConflictErrorResponse || isRejectedFinishPushResponse(value)) {
    return json(value, { status: 409 });
  }
  if (value instanceof DeploymentStorageErrorResponse) {
    return json(value, { status: 500 });
  }
  return json(value);
}

function isRejectedFinishPushResponse(value: object): value is { readonly result: "rejected" } {
  return "result" in value && value.result === "rejected";
}
