import { Data, Effect } from "effect";
import {
  decodePublicInvokeRequestBodyEffect,
  InvokeProtocolValidationError,
  parsePublicInvokeRequestBody,
  type PublicInvokeRequestBody,
} from "flarex-protocol/invoke";
import type { InvokeRequest, Json } from "../types";

export class MissingInvokeDeploymentError
  extends Data.TaggedError("MissingInvokeDeploymentError")<{}> {}

export class MissingInvokePathError
  extends Data.TaggedError("MissingInvokePathError")<{}> {}

export class MissingInvokePartitionKeyError
  extends Data.TaggedError("MissingInvokePartitionKeyError")<{}> {}

export const decodePublicInvokePayload = Effect.fn(
  "InvokeRequests.decodePublicInvokePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<PublicInvokeRequestBody, InvokeProtocolValidationError> {
  return yield* decodePublicInvokeRequestBodyEffect(value);
});

export function parsePublicInvokePayload(value: unknown): PublicInvokeRequestBody {
  return parsePublicInvokeRequestBody(value);
}

export const publicInvokeDeploymentIdEffect = Effect.fn(
  "InvokeRequests.publicInvokeDeploymentId",
)(function* (
  routeDeploymentId: string | undefined,
  body: PublicInvokeRequestBody,
): Effect.fn.Return<string, MissingInvokeDeploymentError> {
  const deploymentId = routeDeploymentId ?? body.deploymentId;
  if (deploymentId === undefined || deploymentId.length === 0) {
    return yield* Effect.fail(new MissingInvokeDeploymentError());
  }
  return deploymentId;
});

export const invokeRequestFromPublicInvokeBodyEffect = Effect.fn(
  "InvokeRequests.invokeRequestFromPublicInvokeBody",
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
