import { Effect } from "effect";
import {
  InvokeProtocolValidationError,
  parsePublicInvokeRequestBody,
  type PublicInvokeRequestBody,
} from "flarex-protocol/invoke";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";

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
    return parsePublicInvokeRequestBody(value);
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
  return Effect.suspend(() => {
    try {
      return Effect.succeed(parsePublicInvokeRequestBody(value));
    } catch (error) {
      if (error instanceof InvokeProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}

function publicInvokeRouteErrorToHttpError(
  error: RequestJsonError | InvokeProtocolValidationError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
