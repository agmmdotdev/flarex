import { HttpError } from "../http.ts";
import { ExecutionArtifactRuntimeOperationError } from "./Errors.ts";

const FALLBACK_OPERATION_ERROR_MESSAGE =
  "Execution artifact runtime operation failed.";

export function executionArtifactRuntimeOperationErrorFromUnknown(
  operation: ExecutionArtifactRuntimeOperationError["operation"],
  cause: unknown,
): ExecutionArtifactRuntimeOperationError {
  return new ExecutionArtifactRuntimeOperationError({
    operation,
    status: errorStatus(cause) ?? 500,
    message: errorMessage(cause),
    cause,
  });
}

function errorStatus(error: unknown): number | undefined {
  try {
    if (error instanceof HttpError) return error.status;
    if (typeof error !== "object" || error === null) return undefined;
    const status: unknown = Reflect.get(error, "status");
    return typeof status === "number" && Number.isInteger(status)
      ? status
      : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  try {
    if (!(error instanceof Error)) return String(error);
    const message: unknown = error.message;
    return typeof message === "string" ? message : String(message);
  } catch {
    return FALLBACK_OPERATION_ERROR_MESSAGE;
  }
}
