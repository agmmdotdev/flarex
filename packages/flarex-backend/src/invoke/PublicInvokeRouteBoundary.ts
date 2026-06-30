import { Data, Effect } from "effect";
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
import type { InvokeRequest, Json } from "../types";

export class MissingInvokeDeploymentError
  extends Data.TaggedError("MissingInvokeDeploymentError")<{}> {}

export class MissingInvokePathError
  extends Data.TaggedError("MissingInvokePathError")<{}> {}

export class MissingInvokePartitionKeyError
  extends Data.TaggedError("MissingInvokePartitionKeyError")<{}> {}

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

export const invokeRequestFromPublicInvokeBodyEffect = Effect.fn(
  "PublicInvokeRouteBoundary.invokeRequestFromPublicInvokeBody",
)(function* (
  body: PublicInvokeRequestBody,
): Effect.fn.Return<InvokeRequest, MissingInvokePathError | MissingInvokePartitionKeyError> {
  if (body.path === undefined || body.path.length === 0) {
    return yield* Effect.fail(new MissingInvokePathError());
  }
  if (body.partitionKey !== undefined && body.partitionKey.length === 0) {
    return yield* Effect.fail(new MissingInvokePartitionKeyError());
  }

  return {
    path: body.path,
    args: (body.args ?? null) as Json,
    ...(body.kind === undefined ? {} : { kind: body.kind }),
    ...(body.partitionKey === undefined ? {} : { partitionKey: body.partitionKey }),
    ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
  };
});

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
