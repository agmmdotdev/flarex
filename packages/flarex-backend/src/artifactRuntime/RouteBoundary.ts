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
  return unwrapExecutionArtifactInvokePayloadValidation(
    normalizeExecutionArtifactInvokePayload(value),
  );
}

export function parseExecutionArtifactInvokePayloadEffect(
  value: unknown,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  return executionArtifactInvokePayloadValidationResultToEffect(
    normalizeExecutionArtifactInvokePayload(value),
  );
}

export function executionArtifactInvokeRouteErrorToHttpError(
  error: ExecutionArtifactInvokeRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

function normalizeExecutionArtifactInvokePayload(
  value: unknown,
): ExecutionArtifactInvokePayloadValidationResult<ExecutionArtifactInvokePayload> {
  if (isExecutionArtifactInvokePayload(value)) {
    return executionArtifactInvokePayloadValidationSuccess(value);
  }
  return executionArtifactInvokePayloadValidationFailure(INVALID_INVOKE_PAYLOAD_MESSAGE);
}

type ExecutionArtifactInvokePayloadValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: ExecutionArtifactInvokePayloadError;
    };

function executionArtifactInvokePayloadValidationSuccess<A>(
  value: A,
): ExecutionArtifactInvokePayloadValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function executionArtifactInvokePayloadValidationFailure<A = never>(
  message: string,
): ExecutionArtifactInvokePayloadValidationResult<A> {
  return {
    success: false,
    error: new ExecutionArtifactInvokePayloadError({ message }),
  };
}

function executionArtifactInvokePayloadValidationResultToEffect<A>(
  result: ExecutionArtifactInvokePayloadValidationResult<A>,
): Effect.Effect<A, ExecutionArtifactInvokePayloadError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapExecutionArtifactInvokePayloadValidation<A>(
  result: ExecutionArtifactInvokePayloadValidationResult<A>,
): A {
  if (result.success) return result.value;
  throw executionArtifactInvokeRouteErrorToHttpError(result.error);
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
