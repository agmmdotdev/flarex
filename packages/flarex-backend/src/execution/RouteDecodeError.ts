import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  badRequestErrorToHttpError,
  HttpError,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";

export type ExecutionRouteDecodeError =
  | RequestJsonError
  | ExecutionProtocolValidationError;

export function executionRouteDecodeErrorToHttpError(
  error: ExecutionRouteDecodeError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  if (error instanceof ExecutionProtocolValidationError) {
    return badRequestErrorToHttpError(error);
  }
  return new HttpError(500, "Unexpected execution route error.");
}
