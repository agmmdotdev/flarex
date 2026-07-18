import { Data, Effect } from "effect";
import { HttpError, readResponseJsonOrNullEffect } from "../http";
import { createResponsePayloadDecoders } from "../responsePayloadDecoding";

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

export class SchedulerResponsePayloadError extends Data.TaggedError(
  "SchedulerResponsePayloadError",
)<{
  readonly operation: SchedulerResponseOperation;
  readonly status: number;
  readonly message: string;
}> {}

const responsePayload = createResponsePayloadDecoders<
  SchedulerResponseOperation,
  SchedulerResponsePayloadError
>((operation, message) => new SchedulerResponsePayloadError({
  operation,
  status: 502,
  message,
}));

export type PendingDeploymentCursor = {
  oldestCreatedAt: string;
  deploymentId: string;
};

export type PendingDeployment = {
  deploymentId: string;
  oldestCreatedAt: string;
  pending: number;
};

export type PendingDeploymentsResult = {
  deployments: PendingDeployment[];
  nextCursor: PendingDeploymentCursor | null;
  hasMore: boolean;
};

export type ExecutorLiveQueryRerunResult = {
  changed: unknown[];
  unchanged: unknown[];
  unsupported: unknown[];
  hasMoreStale: boolean;
};

export type ExpiredConnectionDeploymentCursor = {
  oldestExpiredAt: string;
  deploymentId: string;
};

export type ExpiredConnectionDeployment = {
  deploymentId: string;
  projectId: string;
  oldestExpiredAt: string;
  expiredConnections: number;
};

export type ExpiredConnectionDeploymentsResult = {
  deployments: ExpiredConnectionDeployment[];
  nextCursor: ExpiredConnectionDeploymentCursor | null;
  hasMore: boolean;
};

export type ExecutorDeadLetterStuckResult = {
  scanned: unknown[];
  deadLettered: unknown[];
  reconnectConnectionIds: string[];
  nextCursor: unknown;
  hasMore: boolean;
};

export type ExecutorCleanupLiveQueryConnectionsResult = {
  deleted: number;
  deletedConnections: number;
};

export const decodeSchedulerRerunResponse = Effect.fn("SchedulerDO.decodeRerunResponse")(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "rerun",
      `Live query rerun failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerWakeDeliveryJsonResponse = Effect.fn(
  "SchedulerDO.decodeWakeDeliveryJsonResponse",
)(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "wakeDelivery",
      `Delivery wake failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerCleanupConnectionsResponse = Effect.fn(
  "SchedulerDO.decodeCleanupConnectionsResponse",
)(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "cleanupConnections",
      `Live query connection cleanup failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerExpiredConnectionDeploymentsResponse = Effect.fn(
  "SchedulerDO.decodeExpiredConnectionDeploymentsResponse",
)(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "expiredConnectionDeployments",
      `Live query connection cleanup deployment scan failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerDeadLetterStuckResponse = Effect.fn(
  "SchedulerDO.decodeDeadLetterStuckResponse",
)(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "deadLetterStuck",
      `Live query dead-letter scan failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerForceReconnectJsonResponse = Effect.fn(
  "SchedulerDO.decodeForceReconnectJsonResponse",
)(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "forceReconnect",
      `Force reconnect failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerPendingDeploymentsResponse = Effect.fn(
  "SchedulerDO.decodePendingDeploymentsResponse",
)(
  function* (
    response: SchedulerHttpResponse,
  ): Effect.fn.Return<unknown, SchedulerResponseError> {
    return yield* decodeSchedulerJsonResponse(
      response,
      "pendingDeployments",
      `Live query pending deployment scan failed with status ${response.status}.`,
    );
  },
);

export const decodeSchedulerPendingDeploymentsPayload = Effect.fn(
  "SchedulerDO.decodePendingDeploymentsPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PendingDeploymentsResult, SchedulerResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "pendingDeployments",
      "Pending deployments response must be an object.",
    );
    const deployments = yield* responsePayload.array(
      record.deployments,
      "pendingDeployments",
      "Pending deployments response.deployments must be an array.",
    );
    const decodedDeployments: PendingDeployment[] = [];
    for (const [index, deployment] of deployments.entries()) {
      decodedDeployments.push(
        yield* pendingDeploymentFromUnknown(deployment, `deployments[${index}]`),
      );
    }
    return {
      deployments: decodedDeployments,
      nextCursor: yield* pendingCursorFromUnknown(record.nextCursor),
      hasMore: yield* responsePayload.boolean(
        record.hasMore,
        "hasMore",
        "pendingDeployments",
      ),
    };
  },
);

export const decodeSchedulerRerunPayload = Effect.fn(
  "SchedulerDO.decodeRerunPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<ExecutorLiveQueryRerunResult, SchedulerResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "rerun",
      "Live query rerun response must be an object.",
    );
    return {
      changed: yield* responsePayload.array(
        record.changed,
        "rerun",
        "Live query rerun response.changed must be an array.",
      ),
      unchanged: yield* responsePayload.array(
        record.unchanged,
        "rerun",
        "Live query rerun response.unchanged must be an array.",
      ),
      unsupported: yield* responsePayload.array(
        record.unsupported,
        "rerun",
        "Live query rerun response.unsupported must be an array.",
      ),
      hasMoreStale: yield* responsePayload.boolean(
        record.hasMoreStale,
        "hasMoreStale",
        "rerun",
      ),
    };
  },
);

export const decodeSchedulerExpiredConnectionDeploymentsPayload = Effect.fn(
  "SchedulerDO.decodeExpiredConnectionDeploymentsPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<ExpiredConnectionDeploymentsResult, SchedulerResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "expiredConnectionDeployments",
      "Expired connection deployments response must be an object.",
    );
    const deployments = yield* responsePayload.array(
      record.deployments,
      "expiredConnectionDeployments",
      "Expired connection deployments response.deployments must be an array.",
    );
    const decodedDeployments: ExpiredConnectionDeployment[] = [];
    for (const [index, deployment] of deployments.entries()) {
      decodedDeployments.push(
        yield* expiredConnectionDeploymentFromUnknown(deployment, `deployments[${index}]`),
      );
    }
    return {
      deployments: decodedDeployments,
      nextCursor: yield* expiredConnectionCursorOrNullFromUnknown(record.nextCursor),
      hasMore: yield* responsePayload.boolean(
        record.hasMore,
        "hasMore",
        "expiredConnectionDeployments",
      ),
    };
  },
);

export const decodeSchedulerDeadLetterPayload = Effect.fn(
  "SchedulerDO.decodeDeadLetterPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<ExecutorDeadLetterStuckResult, SchedulerResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "deadLetterStuck",
      "Dead-letter response must be an object.",
    );
    const reconnectConnectionIds = yield* responsePayload.array(
      record.reconnectConnectionIds,
      "deadLetterStuck",
      "Dead-letter response.reconnectConnectionIds must be an array.",
    );
    const decodedReconnectConnectionIds: string[] = [];
    for (const [index, connectionId] of reconnectConnectionIds.entries()) {
      decodedReconnectConnectionIds.push(
        yield* responsePayload.nonEmptyString(
          connectionId,
          `reconnectConnectionIds[${index}]`,
          "deadLetterStuck",
        ),
      );
    }
    return {
      scanned: yield* responsePayload.array(
        record.scanned,
        "deadLetterStuck",
        "Dead-letter response.scanned must be an array.",
      ),
      deadLettered: yield* responsePayload.array(
        record.deadLettered,
        "deadLetterStuck",
        "Dead-letter response.deadLettered must be an array.",
      ),
      reconnectConnectionIds: decodedReconnectConnectionIds,
      nextCursor: record.nextCursor ?? null,
      hasMore: yield* responsePayload.boolean(
        record.hasMore,
        "hasMore",
        "deadLetterStuck",
      ),
    };
  },
);

export const decodeSchedulerForceReconnectPayload = Effect.fn(
  "SchedulerDO.decodeForceReconnectPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<{ closed: number }, SchedulerResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "forceReconnect",
      "ConnectionDO force-reconnect response must be an object.",
    );
    return {
      closed: yield* responsePayload.nonNegativeInteger(
        record.closed,
        "forceReconnect.closed",
        "forceReconnect",
      ),
    };
  },
);

export const decodeSchedulerCleanupConnectionsPayload = Effect.fn(
  "SchedulerDO.decodeCleanupConnectionsPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<ExecutorCleanupLiveQueryConnectionsResult, SchedulerResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "cleanupConnections",
      "Connection cleanup response must be an object.",
    );
    return {
      deleted: yield* responsePayload.nonNegativeInteger(
        record.deleted,
        "cleanup.deleted",
        "cleanupConnections",
      ),
      deletedConnections: yield* responsePayload.nonNegativeInteger(
        record.deletedConnections,
        "cleanup.deletedConnections",
        "cleanupConnections",
      ),
    };
  },
);

function decodeSchedulerJsonResponse(
  response: SchedulerHttpResponse,
  operation: SchedulerResponseOperation,
  message: string,
): Effect.Effect<unknown, SchedulerResponseError> {
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
    return body;
  });
}

function readSchedulerResponseJson(response: SchedulerHttpResponse): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

export function schedulerResponseErrorToHttpError(error: SchedulerResponseError): HttpError {
  return new HttpError(502, error.message);
}

export const schedulerResponseErrorToHttpErrorEffect = Effect.fn(
  "SchedulerResponses.responseErrorToHttpError",
)(function* (
  error: SchedulerResponseError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(schedulerResponseErrorToHttpError(error));
});

export function schedulerResponsePayloadErrorToHttpError(
  error: SchedulerResponsePayloadError,
): HttpError {
  return new HttpError(error.status, error.message);
}

export const schedulerResponsePayloadErrorToHttpErrorEffect = Effect.fn(
  "SchedulerResponses.responsePayloadErrorToHttpError",
)(function* (
  error: SchedulerResponsePayloadError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(schedulerResponsePayloadErrorToHttpError(error));
});

function pendingDeploymentFromUnknown(
  value: unknown,
  path: string,
): Effect.Effect<PendingDeployment, SchedulerResponsePayloadError> {
  return Effect.gen(function* () {
    const record = yield* responsePayload.record(
      value,
      "pendingDeployments",
      `${path} must be an object.`,
    );
    return {
      deploymentId: yield* responsePayload.nonEmptyString(
        record.deploymentId,
        `${path}.deploymentId`,
        "pendingDeployments",
      ),
      oldestCreatedAt: yield* responsePayload.isoDateString(
        record.oldestCreatedAt,
        `${path}.oldestCreatedAt`,
        "pendingDeployments",
      ),
      pending: yield* responsePayload.nonNegativeInteger(
        record.pending,
        `${path}.pending`,
        "pendingDeployments",
      ),
    };
  });
}

function pendingCursorFromUnknown(
  value: unknown,
): Effect.Effect<PendingDeploymentCursor | null, SchedulerResponsePayloadError> {
  if (value === null) return Effect.succeed(null);
  return Effect.gen(function* () {
    const record = yield* responsePayload.record(
      value,
      "pendingDeployments",
      "Pending deployments response.nextCursor must be null or an object.",
    );
    return {
      oldestCreatedAt: yield* responsePayload.isoDateString(
        record.oldestCreatedAt,
        "nextCursor.oldestCreatedAt",
        "pendingDeployments",
      ),
      deploymentId: yield* responsePayload.nonEmptyString(
        record.deploymentId,
        "nextCursor.deploymentId",
        "pendingDeployments",
      ),
    };
  });
}

function expiredConnectionDeploymentFromUnknown(
  value: unknown,
  path: string,
): Effect.Effect<ExpiredConnectionDeployment, SchedulerResponsePayloadError> {
  return Effect.gen(function* () {
    const record = yield* responsePayload.record(
      value,
      "expiredConnectionDeployments",
      `${path} must be an object.`,
    );
    return {
      deploymentId: yield* responsePayload.nonEmptyString(
        record.deploymentId,
        `${path}.deploymentId`,
        "expiredConnectionDeployments",
      ),
      projectId: yield* responsePayload.nonEmptyString(
        record.projectId,
        `${path}.projectId`,
        "expiredConnectionDeployments",
      ),
      oldestExpiredAt: yield* responsePayload.isoDateString(
        record.oldestExpiredAt,
        `${path}.oldestExpiredAt`,
        "expiredConnectionDeployments",
      ),
      expiredConnections: yield* responsePayload.nonNegativeInteger(
        record.expiredConnections,
        `${path}.expiredConnections`,
        "expiredConnectionDeployments",
      ),
    };
  });
}

function expiredConnectionCursorOrNullFromUnknown(
  value: unknown,
): Effect.Effect<ExpiredConnectionDeploymentCursor | null, SchedulerResponsePayloadError> {
  if (value === null) return Effect.succeed(null);
  return expiredConnectionCursorFromUnknown(value, "nextCursor");
}

function expiredConnectionCursorFromUnknown(
  value: unknown,
  path: string,
): Effect.Effect<ExpiredConnectionDeploymentCursor, SchedulerResponsePayloadError> {
  return Effect.gen(function* () {
    const record = yield* responsePayload.record(
      value,
      "expiredConnectionDeployments",
      `${path} must be an object.`,
    );
    return {
      oldestExpiredAt: yield* responsePayload.isoDateString(
        record.oldestExpiredAt,
        `${path}.oldestExpiredAt`,
        "expiredConnectionDeployments",
      ),
      deploymentId: yield* responsePayload.nonEmptyString(
        record.deploymentId,
        `${path}.deploymentId`,
        "expiredConnectionDeployments",
      ),
    };
  });
}
