import { Effect } from "effect";
import {
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentRoute,
  DeploymentStorageErrorResponse,
} from "flarex-protocol/deployment";
import { errorResponse, json } from "../http";
import {
  deploymentAbandonPushHandler,
  deploymentFinishPushHandler,
  deploymentGetActiveDeploymentHandler,
  deploymentGetPushHandler,
  deploymentHealthHandler,
  deploymentStartAnalyzedPushHandler,
} from "./HttpApiHandlers";
import {
  decodeDeploymentApiRouteInput,
  deploymentRouteErrorToHttpError,
  type DeploymentApiRouteInput,
  type DeploymentRouteError,
} from "./HttpApiRouteBoundary";
import { DeploymentService, type DeploymentServiceApi } from "./Service";

export type DeploymentInternalRouteError = DeploymentRouteError;

export type DeploymentApiMutationRouteInput = Extract<
  DeploymentApiRouteInput,
  | { readonly _tag: "DeploymentApiStartAnalyzedPushRoute" }
  | { readonly _tag: "DeploymentApiFinishPushRoute" }
  | { readonly _tag: "DeploymentApiAbandonPushRoute" }
>;

export type DeploymentApiReadRouteInput = Extract<
  DeploymentApiRouteInput,
  | { readonly _tag: "DeploymentApiHealthRoute" }
  | { readonly _tag: "DeploymentApiActiveDeploymentRoute" }
  | { readonly _tag: "DeploymentApiGetPushRoute" }
>;

export const routeDeploymentDurableObject = Effect.fn("DeploymentDO.route")(
  function* (
    request: Request,
  ): Effect.fn.Return<Response, DeploymentInternalRouteError, DeploymentService> {
    const url = new URL(request.url);
    const apiRouteInput = yield* decodeDeploymentApiRouteInput(request);
    if (apiRouteInput !== null) {
      const deployment = yield* DeploymentService;
      if (isDeploymentApiMutationRouteInput(apiRouteInput)) {
        return yield* dispatchDeploymentApiMutationRouteInputDirect(apiRouteInput, deployment);
      }
      return yield* dispatchDeploymentApiReadRouteInputDirect(apiRouteInput, deployment);
    }
    if (url.pathname === DeploymentRoute.health) {
      return json({ service: "flarex-deployment", status: "ok" });
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

export const dispatchDeploymentApiMutationRouteInputDirect = Effect.fn(
  "DeploymentDO.dispatchApiMutationRouteInputDirect",
)(function* (
  apiRouteInput: DeploymentApiMutationRouteInput,
  deployment: DeploymentServiceApi,
): Effect.fn.Return<Response> {
  if (apiRouteInput._tag === "DeploymentApiStartAnalyzedPushRoute") {
    return yield* deploymentStartAnalyzedPushHandler(deployment, apiRouteInput.body).pipe(
      Effect.match({
        onFailure: deploymentGeneratedValueToResponse,
        onSuccess: deploymentGeneratedValueToResponse,
      }),
    );
  }
  if (apiRouteInput._tag === "DeploymentApiFinishPushRoute") {
    return yield* deploymentFinishPushHandler(deployment, apiRouteInput.pushId).pipe(
      Effect.match({
        onFailure: deploymentGeneratedValueToResponse,
        onSuccess: deploymentGeneratedValueToResponse,
      }),
    );
  }
  return yield* deploymentAbandonPushHandler(deployment, apiRouteInput.pushId, apiRouteInput.body).pipe(
    Effect.match({
      onFailure: deploymentGeneratedValueToResponse,
      onSuccess: deploymentGeneratedValueToResponse,
    }),
  );
});

export const dispatchDeploymentApiReadRouteInputDirect = Effect.fn(
  "DeploymentDO.dispatchApiReadRouteInputDirect",
)(function* (
  apiRouteInput: DeploymentApiReadRouteInput,
  deployment: DeploymentServiceApi,
): Effect.fn.Return<Response> {
  if (apiRouteInput._tag === "DeploymentApiHealthRoute") {
    return yield* deploymentHealthHandler().pipe(
      Effect.match({
        onFailure: deploymentGeneratedValueToResponse,
        onSuccess: deploymentGeneratedValueToResponse,
      }),
    );
  }
  if (apiRouteInput._tag === "DeploymentApiActiveDeploymentRoute") {
    return yield* deploymentGetActiveDeploymentHandler(deployment).pipe(
      Effect.match({
        onFailure: deploymentGeneratedValueToResponse,
        onSuccess: deploymentGeneratedValueToResponse,
      }),
    );
  }
  return yield* deploymentGetPushHandler(deployment, apiRouteInput.pushId).pipe(
    Effect.match({
      onFailure: deploymentGeneratedValueToResponse,
      onSuccess: deploymentGeneratedValueToResponse,
    }),
  );
});

export function runDeploymentDurableObjectRoute(
  effect: Effect.Effect<Response, DeploymentInternalRouteError>,
): Promise<Response> {
  // Deliberate runtime bridge: Durable Object fetch handlers return Promises.
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(deploymentInternalRouteErrorToResponseEffect),
    ),
  );
}

export function deploymentInternalRouteErrorToResponse(
  error: DeploymentInternalRouteError,
): Response {
  return errorResponse(deploymentRouteErrorToHttpError(error));
}

export const deploymentInternalRouteErrorToResponseEffect = Effect.fn(
  "DeploymentInternalRouteBoundary.deploymentInternalRouteErrorToResponse",
)(function* (
  error: DeploymentInternalRouteError,
): Effect.fn.Return<Response> {
  return yield* Effect.succeed(deploymentInternalRouteErrorToResponse(error));
});

function deploymentGeneratedValueToResponse(value: object): Response {
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

function isDeploymentApiMutationRouteInput(
  apiRouteInput: DeploymentApiRouteInput,
): apiRouteInput is DeploymentApiMutationRouteInput {
  return apiRouteInput._tag === "DeploymentApiStartAnalyzedPushRoute"
    || apiRouteInput._tag === "DeploymentApiFinishPushRoute"
    || apiRouteInput._tag === "DeploymentApiAbandonPushRoute";
}
