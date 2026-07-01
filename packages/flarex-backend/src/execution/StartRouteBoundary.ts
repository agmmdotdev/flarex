import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { readJsonEffect, RequestJsonError } from "../http";
import type { ExecutionStartRequest } from "../types";
import {
  decodeExecutionStartPayload,
  decodePublicExecutionStartPayload,
} from "./Requests";

export type ExecutionStartRouteError = RequestJsonError | ExecutionProtocolValidationError;

export const decodeExecutionStartRouteRequest = Effect.fn(
  "ExecutionStartRouteBoundary.decodeRequest",
)(function* (
  request: Request,
): Effect.fn.Return<ExecutionStartRequest, ExecutionStartRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionStartRoutePayload),
  );
});

export const decodePublicExecutionStartRouteRequest = Effect.fn(
  "ExecutionStartRouteBoundary.decodePublicRequest",
)(function* (
  request: Request,
  deploymentId: string,
): Effect.fn.Return<ExecutionStartRequest, ExecutionStartRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(value => decodePublicExecutionStartRoutePayload(value, deploymentId)),
  );
});

export const decodePublicExecutionStartRoutePayload = Effect.fn(
  "ExecutionStartRouteBoundary.decodePublicPayload",
)(function* (
  value: unknown,
  deploymentId: string,
): Effect.fn.Return<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return yield* decodePublicExecutionStartPayload(value, deploymentId);
});

export const decodeExecutionStartRoutePayload = Effect.fn(
  "ExecutionStartRouteBoundary.decodePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionStartRequest, ExecutionProtocolValidationError> {
  return yield* decodeExecutionStartPayload(value);
});
