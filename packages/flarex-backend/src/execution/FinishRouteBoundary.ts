import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { readJsonEffect, RequestJsonError } from "../http";
import type { ExecutionFinishRequest } from "../types";
import {
  decodeExecutionFinishPayload,
} from "./Requests";

export type ExecutionFinishRouteError = RequestJsonError | ExecutionProtocolValidationError;

export const decodeExecutionFinishRouteRequest = Effect.fn(
  "ExecutionFinishRouteBoundary.decodeRequest",
)(function* (
  request: Request,
): Effect.fn.Return<ExecutionFinishRequest, ExecutionFinishRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionFinishRoutePayload),
  );
});

export const decodeExecutionFinishRoutePayload = Effect.fn(
  "ExecutionFinishRouteBoundary.decodePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionFinishRequest, ExecutionProtocolValidationError> {
  return yield* decodeExecutionFinishPayload(value);
});
