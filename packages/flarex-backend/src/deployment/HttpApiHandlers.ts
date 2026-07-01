import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  DeploymentApi,
  type AnalyzedStartPushRequest,
  type AbandonPushRequest,
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  decodeActiveDeploymentStatusEffect,
  decodeFinishPushResponseEffect,
  decodePushStatusEffect,
  DeploymentHealthResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentProtocolValidationError,
  DeploymentStorageErrorResponse,
  parseAnalyzedStartPushRequest,
} from "flarex-protocol/deployment";
import { HttpError } from "../http";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentActiveDeploymentNotFoundError,
  DeploymentArtifactRefError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentStoredPushMissingError,
  DeploymentValidationError,
} from "./Errors";
import {
  DeploymentService,
  type DeploymentServiceApi,
  type StartAnalyzedPushInput,
} from "./Service";
import type { DeploymentSqlError } from "./Store";
import {
  decodeAnalyzedStartPushRequest,
  decodeStartAnalyzedPushInput,
  analyzedStartPushRequest,
  startAnalyzedPushInput,
} from "./Validation";
import { decodeDeploymentAnalyzedStartPushPayload } from "./Requests";

export type DeploymentReadErrorResponse =
  | DeploymentNotFoundErrorResponse
  | DeploymentStorageErrorResponse;

export type DeploymentStartErrorResponse =
  | DeploymentBadRequestErrorResponse
  | DeploymentStorageErrorResponse;

export type DeploymentFinishErrorResponse =
  | DeploymentBadRequestErrorResponse
  | DeploymentNotFoundErrorResponse
  | DeploymentStorageErrorResponse;

export type DeploymentAbandonErrorResponse =
  | DeploymentNotFoundErrorResponse
  | DeploymentConflictErrorResponse
  | DeploymentStorageErrorResponse;

export const DeploymentApiHandlers = HttpApiBuilder.group(
  DeploymentApi,
  "deployment",
  Effect.fn("DeploymentApiHandlers")(function* (handlers) {
    const deployment = yield* DeploymentService;

    return handlers
      .handle("health", () => deploymentHealthHandler())
      .handle("getActiveDeployment", () => deploymentGetActiveDeploymentHandler(deployment))
      .handle("getPush", ({ params }) => deploymentGetPushHandler(deployment, params.pushId))
      .handle("startAnalyzedPush", ({ payload }) =>
        deploymentStartAnalyzedPushHandler(deployment, payload)
      )
      .handle("finishPush", ({ params }) => deploymentFinishPushHandler(deployment, params.pushId))
      .handle("abandonPush", ({ params, payload }) =>
        deploymentAbandonPushHandler(deployment, params.pushId, payload)
      );
  }),
);

export const deploymentHealthHandler = Effect.fn("DeploymentApiHandlers.health")(
  function* () {
    return DeploymentHealthResponse.make({
      service: "flarex-deployment",
      status: "ok",
    });
  },
);

export const deploymentGetActiveDeploymentHandler = Effect.fn(
  "DeploymentApiHandlers.getActiveDeployment",
)(function* (deployment: DeploymentServiceApi) {
  return yield* mapDeploymentReadFailure(deployment.getActiveDeployment()).pipe(
    Effect.flatMap(decodeActiveDeploymentStatusForHttpApi),
  );
});

export const deploymentGetPushHandler = Effect.fn("DeploymentApiHandlers.getPush")(
  function* (deployment: DeploymentServiceApi, pushId: string) {
    return yield* mapDeploymentReadFailure(deployment.getPush(pushId)).pipe(
      Effect.flatMap(decodePushStatusForHttpApi),
    );
  },
);

export const deploymentStartAnalyzedPushHandler = Effect.fn(
  "DeploymentApiHandlers.startAnalyzedPush",
)(function* (
  deployment: DeploymentServiceApi,
  payload: AnalyzedStartPushRequest,
) {
  return yield* decodeStartAnalyzedPushHandlerInput(payload).pipe(
    Effect.flatMap(input => deployment.startAnalyzedPush(input)),
    mapDeploymentStartFailure,
    Effect.flatMap(decodePushStatusForHttpApi),
  );
});

export const deploymentFinishPushHandler = Effect.fn("DeploymentApiHandlers.finishPush")(
  function* (deployment: DeploymentServiceApi, pushId: string) {
    return yield* mapDeploymentFinishFailure(deployment.finishPush(pushId)).pipe(
      Effect.flatMap(decodeFinishPushResponseForHttpApi),
    );
  },
);

export const deploymentAbandonPushHandler = Effect.fn("DeploymentApiHandlers.abandonPush")(
  function* (
    deployment: DeploymentServiceApi,
    pushId: string,
    payload: AbandonPushRequest,
  ) {
    return yield* mapDeploymentAbandonFailure(deployment.abandonPush(pushId, payload)).pipe(
      Effect.flatMap(decodePushStatusForHttpApi),
    );
  },
);

export function mapDeploymentReadFailure<A>(
  effect: Effect.Effect<
    A,
    | DeploymentActiveDeploymentInvalidError
    | DeploymentActiveDeploymentNotFoundError
    | DeploymentPushNotFoundError
    | DeploymentValidationError
    | DeploymentSqlError
  >,
): Effect.Effect<A, DeploymentReadErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentActiveDeploymentInvalidError: error =>
        Effect.fail(deploymentReadFailureToResponse(error)),
      DeploymentActiveDeploymentNotFoundError: error =>
        Effect.fail(deploymentReadFailureToResponse(error)),
      DeploymentPushNotFoundError: error =>
        Effect.fail(deploymentReadFailureToResponse(error)),
      DeploymentValidationError: error =>
        Effect.fail(deploymentReadFailureToResponse(error)),
      DeploymentSqlError: error =>
        Effect.fail(deploymentReadFailureToResponse(error)),
    }),
  );
}

export function mapDeploymentStartFailure<A>(
  effect: Effect.Effect<
    A,
    | DeploymentProtocolValidationError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError
  >,
): Effect.Effect<A, DeploymentStartErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentProtocolValidationError: error =>
        Effect.fail(deploymentStartFailureToResponse(error)),
      DeploymentSqlError: error =>
        Effect.fail(deploymentStartFailureToResponse(error)),
      DeploymentStoredPushMissingError: error =>
        Effect.fail(deploymentStartFailureToResponse(error)),
      DeploymentValidationError: error =>
        Effect.fail(deploymentStartFailureToResponse(error)),
    }),
  );
}

export function mapDeploymentFinishFailure<A>(
  effect: Effect.Effect<
    A,
    | DeploymentArtifactRefError
    | DeploymentPushNotFoundError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError
  >,
): Effect.Effect<A, DeploymentFinishErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentArtifactRefError: error =>
        Effect.fail(deploymentFinishFailureToResponse(error)),
      DeploymentPushNotFoundError: error =>
        Effect.fail(deploymentFinishFailureToResponse(error)),
      DeploymentSqlError: error =>
        Effect.fail(deploymentFinishFailureToResponse(error)),
      DeploymentStoredPushMissingError: error =>
        Effect.fail(deploymentFinishFailureToResponse(error)),
      DeploymentValidationError: error =>
        Effect.fail(deploymentFinishFailureToResponse(error)),
    }),
  );
}

export function mapDeploymentAbandonFailure<A>(
  effect: Effect.Effect<
    A,
    | DeploymentPushInvalidStateError
    | DeploymentPushNotFoundError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError
  >,
): Effect.Effect<A, DeploymentAbandonErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentPushInvalidStateError: error =>
        Effect.fail(deploymentAbandonFailureToResponse(error)),
      DeploymentPushNotFoundError: error =>
        Effect.fail(deploymentAbandonFailureToResponse(error)),
      DeploymentSqlError: error =>
        Effect.fail(deploymentAbandonFailureToResponse(error)),
      DeploymentStoredPushMissingError: error =>
        Effect.fail(deploymentAbandonFailureToResponse(error)),
      DeploymentValidationError: error =>
        Effect.fail(deploymentAbandonFailureToResponse(error)),
    }),
  );
}

export function mapDeploymentProtocolResponseFailure<A>(
  effect: Effect.Effect<A, DeploymentProtocolValidationError>,
): Effect.Effect<A, DeploymentStorageErrorResponse> {
  return effect.pipe(
    Effect.catchTag("DeploymentProtocolValidationError", error =>
      Effect.fail(new DeploymentStorageErrorResponse({ error: error.message }))
    ),
  );
}

export function deploymentReadFailureToResponse(
  error:
    | DeploymentActiveDeploymentInvalidError
    | DeploymentActiveDeploymentNotFoundError
    | DeploymentPushNotFoundError
    | DeploymentValidationError
    | DeploymentSqlError,
): DeploymentReadErrorResponse {
  if (error instanceof DeploymentActiveDeploymentNotFoundError) {
    return new DeploymentNotFoundErrorResponse({ error: "No active deployment." });
  }
  if (error instanceof DeploymentPushNotFoundError) {
    return new DeploymentNotFoundErrorResponse({ error: `Unknown push: ${error.pushId}` });
  }
  if (error instanceof DeploymentActiveDeploymentInvalidError) {
    return new DeploymentStorageErrorResponse({ error: error.message });
  }
  if (error instanceof DeploymentValidationError) {
    return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
  }
  return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
}

export function deploymentStartFailureToResponse(
  error:
    | DeploymentProtocolValidationError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError,
): DeploymentStartErrorResponse {
  if (error instanceof DeploymentProtocolValidationError || error instanceof DeploymentValidationError) {
    return new DeploymentBadRequestErrorResponse({ error: error.message });
  }
  return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
}

export function deploymentFinishFailureToResponse(
  error:
    | DeploymentArtifactRefError
    | DeploymentPushNotFoundError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError,
): DeploymentFinishErrorResponse {
  if (error instanceof DeploymentValidationError) {
    return new DeploymentBadRequestErrorResponse({ error: error.message });
  }
  if (error instanceof DeploymentPushNotFoundError) {
    return new DeploymentNotFoundErrorResponse({ error: `Unknown push: ${error.pushId}` });
  }
  if (error instanceof DeploymentArtifactRefError) {
    return new DeploymentStorageErrorResponse({ error: `Deployment artifact error: ${error.message}` });
  }
  return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
}

export function deploymentAbandonFailureToResponse(
  error:
    | DeploymentPushInvalidStateError
    | DeploymentPushNotFoundError
    | DeploymentSqlError
    | DeploymentStoredPushMissingError
    | DeploymentValidationError,
): DeploymentAbandonErrorResponse {
  if (error instanceof DeploymentPushNotFoundError) {
    return new DeploymentNotFoundErrorResponse({ error: `Unknown push: ${error.pushId}` });
  }
  if (error instanceof DeploymentPushInvalidStateError) {
    return new DeploymentConflictErrorResponse({
      error: `Cannot abandon push ${error.pushId} in state ${error.state}.`,
    });
  }
  if (error instanceof DeploymentValidationError) {
    return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
  }
  return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
}

export function deploymentHttpErrorToReadResponse(error: HttpError): DeploymentReadErrorResponse {
  if (error.status === 404) {
    return new DeploymentNotFoundErrorResponse({ error: error.message });
  }
  return new DeploymentStorageErrorResponse({ error: error.message });
}

export function deploymentHttpErrorToStartResponse(error: HttpError): DeploymentStartErrorResponse {
  if (error.status === 400) {
    return new DeploymentBadRequestErrorResponse({ error: error.message });
  }
  return new DeploymentStorageErrorResponse({ error: error.message });
}

export function deploymentHttpErrorToFinishResponse(error: HttpError): DeploymentFinishErrorResponse {
  if (error.status === 400) {
    return new DeploymentBadRequestErrorResponse({ error: error.message });
  }
  if (error.status === 404) {
    return new DeploymentNotFoundErrorResponse({ error: error.message });
  }
  return new DeploymentStorageErrorResponse({ error: error.message });
}

export function deploymentHttpErrorToAbandonResponse(error: HttpError): DeploymentAbandonErrorResponse {
  if (error.status === 404) {
    return new DeploymentNotFoundErrorResponse({ error: error.message });
  }
  if (error.status === 409) {
    return new DeploymentConflictErrorResponse({ error: error.message });
  }
  return new DeploymentStorageErrorResponse({ error: error.message });
}

export const decodeStartAnalyzedPushHandlerInput = Effect.fn(
  "decodeStartAnalyzedPushHandlerInput",
)(function* (
  payload: AnalyzedStartPushRequest,
): Effect.fn.Return<
  StartAnalyzedPushInput,
  DeploymentProtocolValidationError | DeploymentValidationError
> {
  const protocolPayload = yield* decodeDeploymentAnalyzedStartPushPayload(payload);
  const request = yield* decodeAnalyzedStartPushRequest(protocolPayload);
  return yield* decodeStartAnalyzedPushInput(request);
});

export function startAnalyzedPushHandlerInputFromPayload(
  payload: AnalyzedStartPushRequest,
): StartAnalyzedPushInput {
  return startAnalyzedPushInput(analyzedStartPushRequest(parseAnalyzedStartPushRequest(payload)));
}

export const decodePushStatusForHttpApi = Effect.fn(
  "DeploymentApiHandlers.decodePushStatusForHttpApi",
)(function* (value: unknown) {
  return yield* mapDeploymentProtocolResponseFailure(decodePushStatusEffect(value));
});

export const decodeActiveDeploymentStatusForHttpApi = Effect.fn(
  "DeploymentApiHandlers.decodeActiveDeploymentStatusForHttpApi",
)(function* (value: unknown) {
  return yield* mapDeploymentProtocolResponseFailure(decodeActiveDeploymentStatusEffect(value));
});

export const decodeFinishPushResponseForHttpApi = Effect.fn(
  "DeploymentApiHandlers.decodeFinishPushResponseForHttpApi",
)(function* (value: unknown) {
  return yield* mapDeploymentProtocolResponseFailure(decodeFinishPushResponseEffect(value));
});
