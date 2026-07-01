import { Effect } from "effect";
import {
  InvokeProtocolValidationError,
  type PublicInvokeRequestBody,
} from "flarex-protocol/invoke";
import { readJsonEffect, RequestJsonError } from "../http";
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
  | InvokeProtocolValidationError;

export const decodePublicInvokeRouteRequest = Effect.fn(
  "PublicInvokeRouteBoundary.decodeRequest",
)(function* (
  request: Request,
): Effect.fn.Return<PublicInvokeRequestBody, PublicInvokeRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodePublicInvokeRoutePayload),
  );
});

export const decodePublicInvokeRoutePayload = Effect.fn(
  "PublicInvokeRouteBoundary.decodePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<PublicInvokeRequestBody, InvokeProtocolValidationError> {
  return yield* decodePublicInvokePayload(value);
});
