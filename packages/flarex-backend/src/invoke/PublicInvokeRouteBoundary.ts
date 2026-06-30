import { Effect } from "effect";
import {
  InvokeProtocolValidationError,
  type PublicInvokeRequestBody,
} from "flarex-protocol/invoke";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import {
  decodePublicInvokePayload,
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokeDeploymentError,
  MissingInvokePartitionKeyError,
  MissingInvokePathError,
  parsePublicInvokePayload,
  publicInvokeDeploymentIdEffect,
} from "./Requests";

export {
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokeDeploymentError,
  MissingInvokePartitionKeyError,
  MissingInvokePathError,
  publicInvokeDeploymentIdEffect,
} from "./Requests";

export type PublicInvokeRouteError =
  | RequestJsonError
  | InvokeProtocolValidationError
  | MissingInvokeDeploymentError
  | MissingInvokePathError
  | MissingInvokePartitionKeyError;

export async function readPublicInvokeRequest(
  request: Request,
): Promise<PublicInvokeRequestBody> {
  return await Effect.runPromise(
    decodePublicInvokeRouteRequest(request).pipe(
      Effect.mapError(publicInvokeRouteErrorToHttpError),
    ),
  );
}

export function decodePublicInvokeRouteRequest(
  request: Request,
): Effect.Effect<PublicInvokeRequestBody, RequestJsonError | InvokeProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePublicInvokeRouteRequestEffect),
  );
}

export function parsePublicInvokeRouteRequest(
  value: unknown,
): PublicInvokeRequestBody {
  try {
    return parsePublicInvokePayload(value);
  } catch (error) {
    if (error instanceof InvokeProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}

export function parsePublicInvokeRouteRequestEffect(
  value: unknown,
): Effect.Effect<PublicInvokeRequestBody, InvokeProtocolValidationError> {
  return decodePublicInvokePayload(value);
}

export function publicInvokeRouteErrorToHttpError(
  error: PublicInvokeRouteError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  if (error instanceof MissingInvokeDeploymentError) {
    return new HttpError(400, "Missing deployment id.");
  }
  if (error instanceof MissingInvokePathError) {
    return new HttpError(400, "Missing function path.");
  }
  if (error instanceof MissingInvokePartitionKeyError) {
    return new HttpError(400, "Missing partition key.");
  }
  return new HttpError(400, error.message);
}
