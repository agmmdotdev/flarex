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
  DeploymentActiveDeploymentInvalidError,
  DeploymentActiveDeploymentNotFoundError,
  DeploymentArtifactRefError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentStoredPushMissingError,
  DeploymentValidationError,
} from "./Errors";
import { DeploymentService, type StartAnalyzedPushInput } from "./Service";
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
        mapDeploymentAbandonFailure(deployment.abandonPush(params.pushId, payload)).pipe(
          Effect.flatMap(parsePushStatusForHttpApi),
        )
      );
  }),
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
