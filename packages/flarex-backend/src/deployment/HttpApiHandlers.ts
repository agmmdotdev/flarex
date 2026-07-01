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

export type DeploymentReadFailure =
  | DeploymentActiveDeploymentInvalidError
  | DeploymentActiveDeploymentNotFoundError
  | DeploymentPushNotFoundError
  | DeploymentValidationError
  | DeploymentSqlError;

export type DeploymentStartFailure =
  | DeploymentProtocolValidationError
  | DeploymentSqlError
  | DeploymentStoredPushMissingError
  | DeploymentValidationError;

export type DeploymentFinishFailure =
  | DeploymentArtifactRefError
  | DeploymentPushNotFoundError
  | DeploymentSqlError
  | DeploymentStoredPushMissingError
  | DeploymentValidationError;

export type DeploymentAbandonFailure =
  | DeploymentPushInvalidStateError
  | DeploymentPushNotFoundError
  | DeploymentSqlError
  | DeploymentStoredPushMissingError
  | DeploymentValidationError;

export type DeploymentProtocolResponseFailure =
  DeploymentProtocolValidationError;

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
  effect: Effect.Effect<A, DeploymentReadFailure>,
): Effect.Effect<A, DeploymentReadErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentActiveDeploymentInvalidError: deploymentReadFailureResponseEffect,
      DeploymentActiveDeploymentNotFoundError: deploymentReadFailureResponseEffect,
      DeploymentPushNotFoundError: deploymentReadFailureResponseEffect,
      DeploymentValidationError: deploymentReadFailureResponseEffect,
      DeploymentSqlError: deploymentReadFailureResponseEffect,
    }),
  );
}

export function mapDeploymentStartFailure<A>(
  effect: Effect.Effect<A, DeploymentStartFailure>,
): Effect.Effect<A, DeploymentStartErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentProtocolValidationError: deploymentStartFailureResponseEffect,
      DeploymentSqlError: deploymentStartFailureResponseEffect,
      DeploymentStoredPushMissingError: deploymentStartFailureResponseEffect,
      DeploymentValidationError: deploymentStartFailureResponseEffect,
    }),
  );
}

export function mapDeploymentFinishFailure<A>(
  effect: Effect.Effect<A, DeploymentFinishFailure>,
): Effect.Effect<A, DeploymentFinishErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentArtifactRefError: deploymentFinishFailureResponseEffect,
      DeploymentPushNotFoundError: deploymentFinishFailureResponseEffect,
      DeploymentSqlError: deploymentFinishFailureResponseEffect,
      DeploymentStoredPushMissingError: deploymentFinishFailureResponseEffect,
      DeploymentValidationError: deploymentFinishFailureResponseEffect,
    }),
  );
}

export function mapDeploymentAbandonFailure<A>(
  effect: Effect.Effect<A, DeploymentAbandonFailure>,
): Effect.Effect<A, DeploymentAbandonErrorResponse> {
  return effect.pipe(
    Effect.catchTags({
      DeploymentPushInvalidStateError: deploymentAbandonFailureResponseEffect,
      DeploymentPushNotFoundError: deploymentAbandonFailureResponseEffect,
      DeploymentSqlError: deploymentAbandonFailureResponseEffect,
      DeploymentStoredPushMissingError: deploymentAbandonFailureResponseEffect,
      DeploymentValidationError: deploymentAbandonFailureResponseEffect,
    }),
  );
}

export const deploymentReadFailureResponseEffect = Effect.fn(
  "DeploymentApiHandlers.deploymentReadFailureResponse",
)(function* (
  error: DeploymentReadFailure,
): Effect.fn.Return<never, DeploymentReadErrorResponse> {
  return yield* Effect.fail(deploymentReadFailureToResponse(error));
});

export const deploymentStartFailureResponseEffect = Effect.fn(
  "DeploymentApiHandlers.deploymentStartFailureResponse",
)(function* (
  error: DeploymentStartFailure,
): Effect.fn.Return<never, DeploymentStartErrorResponse> {
  return yield* Effect.fail(deploymentStartFailureToResponse(error));
});

export const deploymentFinishFailureResponseEffect = Effect.fn(
  "DeploymentApiHandlers.deploymentFinishFailureResponse",
)(function* (
  error: DeploymentFinishFailure,
): Effect.fn.Return<never, DeploymentFinishErrorResponse> {
  return yield* Effect.fail(deploymentFinishFailureToResponse(error));
});

export const deploymentAbandonFailureResponseEffect = Effect.fn(
  "DeploymentApiHandlers.deploymentAbandonFailureResponse",
)(function* (
  error: DeploymentAbandonFailure,
): Effect.fn.Return<never, DeploymentAbandonErrorResponse> {
  return yield* Effect.fail(deploymentAbandonFailureToResponse(error));
});

export function mapDeploymentProtocolResponseFailure<A>(
  effect: Effect.Effect<A, DeploymentProtocolResponseFailure>,
): Effect.Effect<A, DeploymentStorageErrorResponse> {
  return effect.pipe(
    Effect.catchTag("DeploymentProtocolValidationError", deploymentProtocolResponseFailureEffect),
  );
}

export const deploymentProtocolResponseFailureEffect = Effect.fn(
  "DeploymentApiHandlers.deploymentProtocolResponseFailure",
)(function* (
  error: DeploymentProtocolResponseFailure,
): Effect.fn.Return<never, DeploymentStorageErrorResponse> {
  return yield* Effect.fail(deploymentProtocolResponseFailureToResponse(error));
});

export function deploymentReadFailureToResponse(
  error: DeploymentReadFailure,
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
  error: DeploymentStartFailure,
): DeploymentStartErrorResponse {
  if (error instanceof DeploymentProtocolValidationError || error instanceof DeploymentValidationError) {
    return new DeploymentBadRequestErrorResponse({ error: error.message });
  }
  return new DeploymentStorageErrorResponse({ error: "Deployment storage error." });
}

export function deploymentFinishFailureToResponse(
  error: DeploymentFinishFailure,
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
  error: DeploymentAbandonFailure,
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

export function deploymentProtocolResponseFailureToResponse(
  error: DeploymentProtocolResponseFailure,
): DeploymentStorageErrorResponse {
  return new DeploymentStorageErrorResponse({ error: error.message });
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
