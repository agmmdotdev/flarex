import { Effect } from "effect";
import { json, readResponseJsonEffect } from "../http";
import type { ExecutionStartRequest } from "../types";
import type { PublicExecutionAction } from "./ActionRouteBoundary";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicExecutionDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export const startPublicExecutionEffect = Effect.fn(
  "Worker.startPublicExecution",
)(function* (
  execution: PublicExecutionDispatchTarget,
  body: ExecutionStartRequest,
  sessionId: string,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  const response = yield* Effect.tryPromise({
    try: () =>
      execution.fetch("https://flarex.internal/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    catch: error => publicWorkerDispatchError("execution-start", error),
  });
  if (!response.ok) return response;

  const responseBody = yield* readResponseJsonEffect(response).pipe(
    Effect.mapError(error => publicWorkerDispatchError("execution-start-response", error)),
  );
  return json({ sessionId, ...(responseBody as Record<string, unknown>) });
});

export const dispatchPublicExecutionActionEffect = Effect.fn(
  "Worker.dispatchPublicExecutionAction",
)(function* (
  execution: PublicExecutionDispatchTarget,
  action: PublicExecutionAction,
  body: unknown,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () =>
      execution.fetch(`https://flarex.internal/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    catch: error => publicWorkerDispatchError("execution-action", error),
  });
});
