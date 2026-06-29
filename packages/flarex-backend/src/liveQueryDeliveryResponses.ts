import { Data, Effect } from "effect";
import { HttpError } from "./http";

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

export const decodeLiveQueryDeliveryClaimResponse = Effect.fn(
  "LiveQueryDelivery.decodeClaimResponse",
)(
  function* <A>(response: LiveQueryDeliveryHttpResponse) {
    return yield* decodeLiveQueryDeliveryResponse<A>(
      response,
      "claim",
      `Live query delivery claim failed with status ${response.status}.`,
    );
  },
);

export const decodeLiveQueryDeliveryAckResponse = Effect.fn(
  "LiveQueryDelivery.decodeAckResponse",
)(
  function* <A>(response: LiveQueryDeliveryHttpResponse) {
    return yield* decodeLiveQueryDeliveryResponse<A>(
      response,
      "ack",
      `Live query delivery ack failed with status ${response.status}.`,
    );
  },
);

export const decodeConnectionLiveQueryDeliveryResponse = Effect.fn(
  "LiveQueryDelivery.decodeConnectionResponse",
)(
  function* <A>(response: LiveQueryDeliveryHttpResponse, connectionId: string) {
    return yield* decodeLiveQueryDeliveryResponse<A>(
      response,
      "connectionDelivery",
      `ConnectionDO live query delivery failed for ${connectionId} with status ${response.status}.`,
    );
  },
);

function decodeLiveQueryDeliveryResponse<A>(
  response: LiveQueryDeliveryHttpResponse,
  operation: LiveQueryDeliveryResponseOperation,
  message: string,
): Effect.Effect<A, LiveQueryDeliveryResponseError> {
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
    return body as A;
  });
}

function readLiveQueryDeliveryResponseJson(
  response: LiveQueryDeliveryHttpResponse,
): Effect.Effect<unknown> {
  return Effect.promise(() => response.json().catch(() => null));
}

export function liveQueryDeliveryResponseErrorToHttpError(
  error: LiveQueryDeliveryResponseError,
): HttpError {
  return new HttpError(502, error.message);
}
