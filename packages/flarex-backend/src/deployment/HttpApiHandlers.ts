import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  DeploymentApi,
  type AnalyzedStartPushRequest,
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  DeploymentHealthResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentProtocolValidationError,
  DeploymentStorageErrorResponse,
  parseActiveDeploymentStatus,
  parseAnalyzedStartPushRequest,
  parseFinishPushResponse,
  parsePushStatus,
} from "flarex-protocol/deployment";
import { HttpError } from "../http";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "./Errors";
import { deploymentFailureToHttpError } from "./HttpBoundary";
import { DeploymentService, type StartAnalyzedPushInput } from "./Service";
import type { DeploymentSqlError } from "./Store";
import {
  analyzedStartPushRequest,
  startAnalyzedPushInput,
} from "./Validation";

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
      .handle("health", () =>
        Effect.succeed(DeploymentHealthResponse.make({
          service: "flarex-deployment",
          status: "ok",
        }))
      )
      .handle("getActiveDeployment", () =>
        mapDeploymentReadFailure(deployment.getActiveDeployment()).pipe(
          Effect.flatMap(parseActiveDeploymentStatusForHttpApi),
        )
      )
      .handle("getPush", ({ params }) =>
        mapDeploymentReadFailure(deployment.getPush(params.pushId)).pipe(
          Effect.flatMap(parsePushStatusForHttpApi),
        )
      )
      .handle("startAnalyzedPush", ({ payload }) =>
        decodeStartAnalyzedPushHandlerInput(payload).pipe(
          Effect.flatMap(input => deployment.startAnalyzedPush(input)),
          mapDeploymentStartFailure,
          Effect.flatMap(parsePushStatusForHttpApi),
        )
      )
      .handle("finishPush", ({ params }) =>
        mapDeploymentFinishFailure(deployment.finishPush(params.pushId)).pipe(
          Effect.flatMap(parseFinishPushResponseForHttpApi),
        )
      )
      .handle("abandonPush", ({ params, payload }) =>
        mapDeploymentAbandonFailure(deployment.abandonPush(
          params.pushId,
          payload.reason === undefined ? {} : { reason: payload.reason },
        )).pipe(
          Effect.flatMap(parsePushStatusForHttpApi),
        )
      );
  }),
);

export function mapDeploymentReadFailure<A>(
  effect: Effect.Effect<
    A,
    DeploymentActiveDeploymentNotFoundError | DeploymentPushNotFoundError | DeploymentSqlError | HttpError
  >,
): Effect.Effect<A, DeploymentReadErrorResponse> {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.fail(deploymentHttpErrorToReadResponse(deploymentFailureToHttpError(error)))
    ),
  );
}

export function mapDeploymentStartFailure<A>(
  effect: Effect.Effect<A, DeploymentSqlError | HttpError>,
): Effect.Effect<A, DeploymentStartErrorResponse> {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.fail(deploymentHttpErrorToStartResponse(deploymentFailureToHttpError(error)))
    ),
  );
}

export function mapDeploymentFinishFailure<A>(
  effect: Effect.Effect<A, DeploymentPushNotFoundError | DeploymentSqlError | HttpError>,
): Effect.Effect<A, DeploymentFinishErrorResponse> {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.fail(deploymentHttpErrorToFinishResponse(deploymentFailureToHttpError(error)))
    ),
  );
}

export function mapDeploymentAbandonFailure<A>(
  effect: Effect.Effect<
    A,
    DeploymentPushInvalidStateError | DeploymentPushNotFoundError | DeploymentSqlError | HttpError
  >,
): Effect.Effect<A, DeploymentAbandonErrorResponse> {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.fail(deploymentHttpErrorToAbandonResponse(deploymentFailureToHttpError(error)))
    ),
  );
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
): Effect.fn.Return<StartAnalyzedPushInput, HttpError> {
  try {
    return startAnalyzedPushHandlerInputFromPayload(payload);
  } catch (cause) {
    if (cause instanceof HttpError) {
      return yield* Effect.fail(cause);
    }
    return yield* Effect.die(cause);
  }
});

export function startAnalyzedPushHandlerInputFromPayload(
  payload: AnalyzedStartPushRequest,
): StartAnalyzedPushInput {
  try {
    return startAnalyzedPushInput(analyzedStartPushRequest(parseAnalyzedStartPushRequest(payload)));
  } catch (cause) {
    if (cause instanceof DeploymentProtocolValidationError) {
      throw new HttpError(400, cause.message);
    }
    throw cause;
  }
}

const parsePushStatusForHttpApi = responseParser(
  "Deployment push response did not match the deployment protocol.",
  parsePushStatus,
);

const parseActiveDeploymentStatusForHttpApi = responseParser(
  "Active deployment response did not match the deployment protocol.",
  parseActiveDeploymentStatus,
);

const parseFinishPushResponseForHttpApi = responseParser(
  "Finish push response did not match the deployment protocol.",
  parseFinishPushResponse,
);

function responseParser<A>(
  message: string,
  parse: (value: unknown) => A,
): (value: unknown) => Effect.Effect<A, DeploymentStorageErrorResponse> {
  return value =>
    Effect.try({
      try: () => parse(value),
      catch: () => new DeploymentStorageErrorResponse({ error: message }),
    });
}
