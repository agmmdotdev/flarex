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
      Effect.catch(publicInvokeRouteErrorToHttpErrorEffect),
    ),
  );
}

export function decodePublicInvokeRouteRequest(
  request: Request,
): Effect.Effect<PublicInvokeRequestBody, RequestJsonError | InvokeProtocolValidationError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodePublicInvokeRoutePayload),
  );
}

export function parsePublicInvokeRouteRequest(
  value: unknown,
): PublicInvokeRequestBody {
  return Effect.runSync(parsePublicInvokeRouteRequestEffect(value).pipe(
    Effect.catch(publicInvokeRouteErrorToHttpErrorEffect),
  ));
}

export function parsePublicInvokeRouteRequestEffect(
  value: unknown,
): Effect.Effect<PublicInvokeRequestBody, InvokeProtocolValidationError> {
  return decodePublicInvokeRoutePayload(value);
}

export function decodePublicInvokeRoutePayload(
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

export const publicInvokeRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicInvokeRouteBoundary.publicInvokeRouteErrorToHttpError",
)(function* (
  error: PublicInvokeRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(publicInvokeRouteErrorToHttpError(error));
});
