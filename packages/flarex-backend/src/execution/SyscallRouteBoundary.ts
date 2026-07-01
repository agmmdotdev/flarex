import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { readJsonEffect, RequestJsonError } from "../http";
import type { ExecutionSyscallRequest } from "../types";
import {
  decodeExecutionSyscallPayload,
} from "./Requests";

export type ExecutionSyscallRouteError = RequestJsonError | ExecutionProtocolValidationError;

export const decodeExecutionSyscallRouteRequest = Effect.fn(
  "ExecutionSyscallRouteBoundary.decodeRequest",
)(function* (
  request: Request,
): Effect.fn.Return<ExecutionSyscallRequest, ExecutionSyscallRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeExecutionSyscallRoutePayload),
  );
});

export const decodeExecutionSyscallRoutePayload = Effect.fn(
  "ExecutionSyscallRouteBoundary.decodePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionSyscallRequest, ExecutionProtocolValidationError> {
  return yield* decodeExecutionSyscallPayload(value);
});
