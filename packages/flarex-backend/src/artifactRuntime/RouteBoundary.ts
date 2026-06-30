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
  parseExecutionArtifactInvokePayloadBody,
} from "./Requests";

export {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
  parseExecutionArtifactInvokePayloadBody,
} from "./Requests";

export type ExecutionArtifactInvokeRouteError =
  | RequestJsonError
  | ExecutionArtifactInvokePayloadError;

export async function readExecutionArtifactInvokePayload(
  request: Request,
): Promise<ExecutionArtifactInvokePayload> {
  return await Effect.runPromise(
    decodeExecutionArtifactInvokePayload(request).pipe(
      Effect.mapError(executionArtifactInvokeRouteErrorToHttpError),
    ),
  );
}

export function decodeExecutionArtifactInvokePayload(
  request: Request,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokeRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionArtifactInvokePayloadEffect),
  );
}

export function parseExecutionArtifactInvokePayload(
  value: unknown,
): ExecutionArtifactInvokePayload {
  try {
    return parseExecutionArtifactInvokePayloadBody(value);
  } catch (error) {
    if (error instanceof ExecutionArtifactInvokePayloadError) {
      throw executionArtifactInvokeRouteErrorToHttpError(error);
    }
    throw error;
  }
}

export function parseExecutionArtifactInvokePayloadEffect(
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
