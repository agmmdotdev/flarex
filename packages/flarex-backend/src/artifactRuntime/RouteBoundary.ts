import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionArtifactInvokePayload } from "../artifactRuntime";
import {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
} from "./Requests";

export {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
} from "./Requests";

export type ExecutionArtifactInvokeRouteError =
  | RequestJsonError
  | ExecutionArtifactInvokePayloadError;

export function decodeExecutionArtifactInvokePayload(
  request: Request,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionArtifactInvokeRoutePayload),
  );
}

export function decodeExecutionArtifactInvokeRoutePayload(
  value: unknown,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  return decodeExecutionArtifactInvokePayloadBody(value);
}

export function executionArtifactInvokeRouteErrorToHttpError(
  error: ExecutionArtifactInvokeRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const executionArtifactInvokeRouteErrorToHttpErrorEffect = Effect.fn(
  "ArtifactRuntimeRouteBoundary.executionArtifactInvokeRouteErrorToHttpError",
)(function* (
  error: ExecutionArtifactInvokeRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(executionArtifactInvokeRouteErrorToHttpError(error));
});
