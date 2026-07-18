import { Data, Effect } from "effect";
import { HttpError, readResponseJsonOrNullEffect } from "./http";
import { createResponsePayloadDecoders } from "./responsePayloadDecoding";

type LiveQueryDeliveryHttpResponse = Pick<Response, "json" | "ok" | "status">;

export type LiveQueryDeliveryResponseOperation =
  | "claim"
  | "ack"
  | "connectionDelivery";

export class LiveQueryDeliveryResponseError extends Data.TaggedError(
  "LiveQueryDeliveryResponseError",
)<{
  readonly operation: LiveQueryDeliveryResponseOperation;
  readonly status: number;
  readonly message: string;
  readonly body: unknown;
}> {}

export class LiveQueryDeliveryResponsePayloadError extends Data.TaggedError(
  "LiveQueryDeliveryResponsePayloadError",
)<{
  readonly operation: LiveQueryDeliveryResponseOperation;
  readonly status: number;
  readonly message: string;
}> {}

const responsePayload = createResponsePayloadDecoders<
  LiveQueryDeliveryResponseOperation,
  LiveQueryDeliveryResponsePayloadError
>((operation, message) => new LiveQueryDeliveryResponsePayloadError({
  operation,
  status: 502,
  message,
}));

export type LiveQueryDeliveryCursor = {
  createdAt: string;
  deliveryId: string;
};

export type LiveQueryDeliveryRecord = {
  deploymentId: string;
  deliveryId: string;
  connectionId: string;
  queryId: number;
  payloadJson: unknown;
};

export type ClaimLiveQueryDeliveryBatchResult = {
  deliveries: LiveQueryDeliveryRecord[];
} & (
  | { hasMore: true; nextCursor: LiveQueryDeliveryCursor }
  | { hasMore: false; nextCursor: LiveQueryDeliveryCursor | null }
);

export const decodeLiveQueryDeliveryClaimResponse = Effect.fn(
  "LiveQueryDelivery.decodeClaimResponse",
)(
  function* (
    response: LiveQueryDeliveryHttpResponse,
  ): Effect.fn.Return<unknown, LiveQueryDeliveryResponseError> {
    return yield* decodeLiveQueryDeliveryResponse(
      response,
      "claim",
      `Live query delivery claim failed with status ${response.status}.`,
    );
  },
);

export const decodeLiveQueryDeliveryAckResponse = Effect.fn(
  "LiveQueryDelivery.decodeAckResponse",
)(
  function* (
    response: LiveQueryDeliveryHttpResponse,
  ): Effect.fn.Return<unknown, LiveQueryDeliveryResponseError> {
    return yield* decodeLiveQueryDeliveryResponse(
      response,
      "ack",
      `Live query delivery ack failed with status ${response.status}.`,
    );
  },
);

export const decodeConnectionLiveQueryDeliveryResponse = Effect.fn(
  "LiveQueryDelivery.decodeConnectionResponse",
)(
  function* (
    response: LiveQueryDeliveryHttpResponse,
    connectionId: string,
  ): Effect.fn.Return<unknown, LiveQueryDeliveryResponseError> {
    return yield* decodeLiveQueryDeliveryResponse(
      response,
      "connectionDelivery",
      `ConnectionDO live query delivery failed for ${connectionId} with status ${response.status}.`,
    );
  },
);

export const decodeLiveQueryDeliveryClaimPayload = Effect.fn(
  "LiveQueryDelivery.decodeClaimPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<
    ClaimLiveQueryDeliveryBatchResult,
    LiveQueryDeliveryResponsePayloadError
  > {
    const record = yield* responsePayload.record(
      value,
      "claim",
      "Live query delivery claim response must be an object.",
    );
    const deliveries = yield* responsePayload.array(
      record.deliveries,
      "claim",
      "Live query delivery claim response.deliveries must be an array.",
    );
    const nextCursor = yield* cursorFromUnknown(record.nextCursor);
    const hasMore = yield* responsePayload.boolean(
      record.hasMore,
      "hasMore",
      "claim",
    );
    if (hasMore && nextCursor === null) {
      return yield* responsePayload.fail(
        "claim",
        "Live query delivery claim response.nextCursor must be an object when hasMore is true.",
      );
    }
    const decodedDeliveries: LiveQueryDeliveryRecord[] = [];
    for (const [index, delivery] of deliveries.entries()) {
      decodedDeliveries.push(
        yield* deliveryRecordFromUnknown(delivery, `deliveries[${index}]`),
      );
    }
    if (hasMore && nextCursor !== null) {
      return {
        deliveries: decodedDeliveries,
        nextCursor,
        hasMore: true,
      };
    }
    return {
      deliveries: decodedDeliveries,
      nextCursor,
      hasMore: false,
    };
  },
);

export const decodeLiveQueryDeliveryAckPayload = Effect.fn(
  "LiveQueryDelivery.decodeAckPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<{ delivered: number }, LiveQueryDeliveryResponsePayloadError> {
    const record = yield* responsePayload.record(
      value,
      "ack",
      "Live query delivery ack response must be an object.",
    );
    return {
      delivered: yield* responsePayload.nonNegativeInteger(
        record.delivered,
        "Live query delivery ack response.delivered",
        "ack",
      ),
    };
  },
);

function decodeLiveQueryDeliveryResponse(
  response: LiveQueryDeliveryHttpResponse,
  operation: LiveQueryDeliveryResponseOperation,
  message: string,
): Effect.Effect<unknown, LiveQueryDeliveryResponseError> {
  return Effect.gen(function* () {
    const body = yield* readLiveQueryDeliveryResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new LiveQueryDeliveryResponseError({
        operation,
        status: response.status,
        message,
        body,
      }));
    }
    return body;
  });
}

function readLiveQueryDeliveryResponseJson(
  response: LiveQueryDeliveryHttpResponse,
): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

export function liveQueryDeliveryResponseErrorToHttpError(
  error: LiveQueryDeliveryResponseError,
): HttpError {
  return new HttpError(502, error.message);
}

export const liveQueryDeliveryResponseErrorToHttpErrorEffect = Effect.fn(
  "LiveQueryDelivery.responseErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryResponseError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(liveQueryDeliveryResponseErrorToHttpError(error));
});

export function liveQueryDeliveryResponsePayloadErrorToHttpError(
  error: LiveQueryDeliveryResponsePayloadError,
): HttpError {
  return new HttpError(error.status, error.message);
}

export const liveQueryDeliveryResponsePayloadErrorToHttpErrorEffect = Effect.fn(
  "LiveQueryDelivery.responsePayloadErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryResponsePayloadError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(liveQueryDeliveryResponsePayloadErrorToHttpError(error));
});

function deliveryRecordFromUnknown(
  value: unknown,
  path: string,
): Effect.Effect<LiveQueryDeliveryRecord, LiveQueryDeliveryResponsePayloadError> {
  return Effect.gen(function* () {
    const record = yield* responsePayload.record(
      value,
      "claim",
      `${path} must be an object.`,
    );
    return {
      deploymentId: yield* responsePayload.nonEmptyString(
        record.deploymentId,
        `${path}.deploymentId`,
        "claim",
      ),
      deliveryId: yield* responsePayload.nonEmptyString(
        record.deliveryId,
        `${path}.deliveryId`,
        "claim",
      ),
      connectionId: yield* responsePayload.nonEmptyString(
        record.connectionId,
        `${path}.connectionId`,
        "claim",
      ),
      queryId: yield* integerFromUnknown(record.queryId, `${path}.queryId`),
      payloadJson: record.payloadJson,
    };
  });
}

function cursorFromUnknown(
  value: unknown,
): Effect.Effect<LiveQueryDeliveryCursor | null, LiveQueryDeliveryResponsePayloadError> {
  if (value === null) return Effect.succeed(null);
  return Effect.gen(function* () {
    const record = yield* responsePayload.record(
      value,
      "claim",
      "Live query delivery claim response.nextCursor must be null or an object.",
    );
    return {
      createdAt: yield* responsePayload.isoDateString(
        record.createdAt,
        "nextCursor.createdAt",
        "claim",
      ),
      deliveryId: yield* responsePayload.nonEmptyString(
        record.deliveryId,
        "nextCursor.deliveryId",
        "claim",
      ),
    };
  });
}

function integerFromUnknown(
  value: unknown,
  field: string,
): Effect.Effect<number, LiveQueryDeliveryResponsePayloadError> {
  if (typeof value === "number" && Number.isInteger(value)) return Effect.succeed(value);
  return responsePayload.fail("claim", `${field} must be an integer.`);
}
