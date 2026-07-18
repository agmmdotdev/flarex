import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { Data, Effect } from "effect";
import { normalizeDateString } from "./dateStringNormalization";
import { HttpError, readResponseJsonOrNullEffect } from "./http";

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
    const record = yield* responseRecord(
      value,
      "claim",
      "Live query delivery claim response must be an object.",
    );
    const deliveries = yield* arrayField(
      record.deliveries,
      "claim",
      "Live query delivery claim response.deliveries must be an array.",
    );
    const nextCursor = yield* cursorFromUnknown(record.nextCursor);
    const hasMore = yield* booleanFromUnknown(record.hasMore, "hasMore");
    if (hasMore && nextCursor === null) {
      return yield* failPayload(
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
    const record = yield* responseRecord(
      value,
      "ack",
      "Live query delivery ack response must be an object.",
    );
    const delivered = record.delivered;
    if (typeof delivered === "number" && Number.isInteger(delivered) && delivered >= 0) {
      return { delivered };
    }
    return yield* failPayload(
      "ack",
      "Live query delivery ack response.delivered must be a non-negative integer.",
    );
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

function responseRecord(
  value: unknown,
  operation: LiveQueryDeliveryResponseOperation,
  message: string,
): Effect.Effect<UnknownRecord, LiveQueryDeliveryResponsePayloadError> {
  if (isNonArrayRecord(value)) {
    return Effect.succeed(value);
  }
  return failPayload(operation, message);
}

function arrayField(
  value: unknown,
  operation: LiveQueryDeliveryResponseOperation,
  message: string,
): Effect.Effect<unknown[], LiveQueryDeliveryResponsePayloadError> {
  return Array.isArray(value) ? Effect.succeed(value) : failPayload(operation, message);
}

function deliveryRecordFromUnknown(
  value: unknown,
  path: string,
): Effect.Effect<LiveQueryDeliveryRecord, LiveQueryDeliveryResponsePayloadError> {
  return Effect.gen(function* () {
    const record = yield* responseRecord(value, "claim", `${path} must be an object.`);
    return {
      deploymentId: yield* stringFromUnknown(record.deploymentId, `${path}.deploymentId`),
      deliveryId: yield* stringFromUnknown(record.deliveryId, `${path}.deliveryId`),
      connectionId: yield* stringFromUnknown(record.connectionId, `${path}.connectionId`),
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
    const record = yield* responseRecord(
      value,
      "claim",
      "Live query delivery claim response.nextCursor must be null or an object.",
    );
    return {
      createdAt: yield* dateStringFromUnknown(record.createdAt, "nextCursor.createdAt"),
      deliveryId: yield* stringFromUnknown(record.deliveryId, "nextCursor.deliveryId"),
    };
  });
}

function stringFromUnknown(
  value: unknown,
  field: string,
): Effect.Effect<string, LiveQueryDeliveryResponsePayloadError> {
  if (typeof value === "string" && value.length > 0) return Effect.succeed(value);
  return failPayload("claim", `${field} must be a non-empty string.`);
}

function dateStringFromUnknown(
  value: unknown,
  field: string,
): Effect.Effect<string, LiveQueryDeliveryResponsePayloadError> {
  return Effect.gen(function* () {
    const text = yield* stringFromUnknown(value, field);
    const normalized = normalizeDateString(text);
    if (normalized !== undefined) return normalized;
    return yield* failPayload("claim", `${field} must be an ISO date string.`);
  });
}

function integerFromUnknown(
  value: unknown,
  field: string,
): Effect.Effect<number, LiveQueryDeliveryResponsePayloadError> {
  if (typeof value === "number" && Number.isInteger(value)) return Effect.succeed(value);
  return failPayload("claim", `${field} must be an integer.`);
}

function booleanFromUnknown(
  value: unknown,
  field: string,
): Effect.Effect<boolean, LiveQueryDeliveryResponsePayloadError> {
  if (typeof value === "boolean") return Effect.succeed(value);
  return failPayload("claim", `${field} must be a boolean.`);
}

function failPayload<A = never>(
  operation: LiveQueryDeliveryResponseOperation,
  message: string,
): Effect.Effect<A, LiveQueryDeliveryResponsePayloadError> {
  return Effect.fail(new LiveQueryDeliveryResponsePayloadError({
    operation,
    status: 502,
    message,
  }));
}
