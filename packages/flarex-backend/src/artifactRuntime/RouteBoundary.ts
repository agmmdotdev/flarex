import { Data, Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { ExecutionArtifactInvokePayload } from "../artifactRuntime";

const INVALID_INVOKE_PAYLOAD_MESSAGE = "Invalid execution artifact invoke payload.";

export class ExecutionArtifactInvokePayloadError extends Data.TaggedError("ExecutionArtifactInvokePayloadError")<{
  readonly message: string;
}> {}

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
): Effect.Effect<ExecutionArtifactInvokePayload, RequestJsonError | ExecutionArtifactInvokePayloadError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseExecutionArtifactInvokePayloadEffect),
  );
}

export function parseExecutionArtifactInvokePayload(
  value: unknown,
): ExecutionArtifactInvokePayload {
  if (isExecutionArtifactInvokePayload(value)) return value;
  throw new HttpError(400, INVALID_INVOKE_PAYLOAD_MESSAGE);
}

export function parseExecutionArtifactInvokePayloadEffect(
  value: unknown,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  if (isExecutionArtifactInvokePayload(value)) {
    return Effect.succeed(value);
  }
  return Effect.fail(new ExecutionArtifactInvokePayloadError({
    message: INVALID_INVOKE_PAYLOAD_MESSAGE,
  }));
}

function executionArtifactInvokeRouteErrorToHttpError(
  error: RequestJsonError | ExecutionArtifactInvokePayloadError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

function isExecutionArtifactInvokePayload(
  value: unknown,
): value is ExecutionArtifactInvokePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<ExecutionArtifactInvokePayload>;
  return (
    typeof payload.deploymentId === "string" &&
    typeof payload.ref === "object" &&
    payload.ref !== null &&
    (payload.sourcePackage === undefined ||
      (typeof payload.sourcePackage === "object" && payload.sourcePackage !== null)) &&
    typeof payload.request === "object" &&
    payload.request !== null
  );
}
