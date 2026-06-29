import { Data, Effect } from "effect";
import { HttpError, readResponseJsonOrNullEffect } from "../http";

type SchedulerHttpResponse = Pick<Response, "json" | "ok" | "status">;

export type SchedulerResponseOperation =
  | "rerun"
  | "wakeDelivery"
  | "cleanupConnections"
  | "expiredConnectionDeployments"
  | "deadLetterStuck"
  | "forceReconnect"
  | "pendingDeployments";

export class SchedulerResponseError extends Data.TaggedError("SchedulerResponseError")<{
  readonly operation: SchedulerResponseOperation;
  readonly status: number;
  readonly message: string;
  readonly body: unknown;
}> {}

export const decodeSchedulerRerunResponse = Effect.fn("SchedulerDO.decodeRerunResponse")(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "rerun",
      `Live query rerun failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerWakeDeliveryJsonResponse = Effect.fn(
  "SchedulerDO.decodeWakeDeliveryJsonResponse",
)(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "wakeDelivery",
      `Delivery wake failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerCleanupConnectionsResponse = Effect.fn(
  "SchedulerDO.decodeCleanupConnectionsResponse",
)(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "cleanupConnections",
      `Live query connection cleanup failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerExpiredConnectionDeploymentsResponse = Effect.fn(
  "SchedulerDO.decodeExpiredConnectionDeploymentsResponse",
)(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "expiredConnectionDeployments",
      `Live query connection cleanup deployment scan failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerDeadLetterStuckResponse = Effect.fn(
  "SchedulerDO.decodeDeadLetterStuckResponse",
)(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "deadLetterStuck",
      `Live query dead-letter scan failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerForceReconnectJsonResponse = Effect.fn(
  "SchedulerDO.decodeForceReconnectJsonResponse",
)(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "forceReconnect",
      `Force reconnect failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerPendingDeploymentsResponse = Effect.fn(
  "SchedulerDO.decodePendingDeploymentsResponse",
)(
  function* <A>(response: SchedulerHttpResponse) {
    return yield* decodeSchedulerJsonResponse<A>(
      response,
      "pendingDeployments",
      `Live query pending deployment scan failed with status ${response.status}.`,
    );
  },
);

function decodeSchedulerJsonResponse<A>(
  response: SchedulerHttpResponse,
  operation: SchedulerResponseOperation,
  message: string,
): Effect.Effect<A, SchedulerResponseError> {
  return Effect.gen(function* () {
    const body = yield* readSchedulerResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new SchedulerResponseError({
        operation,
        status: response.status,
        message,
        body,
      }));
    }
    return body as A;
  });
}

function readSchedulerResponseJson(response: SchedulerHttpResponse): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

export function schedulerResponseErrorToHttpError(error: SchedulerResponseError): HttpError {
  return new HttpError(502, error.message);
}
