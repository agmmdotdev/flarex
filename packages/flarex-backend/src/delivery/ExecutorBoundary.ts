import { Data, Effect } from "effect";
import { HttpError } from "../http";
import {
  decodeLiveQueryDeliveryAckPayload,
  decodeLiveQueryDeliveryAckResponse,
  decodeLiveQueryDeliveryClaimPayload,
  decodeLiveQueryDeliveryClaimResponse,
  LiveQueryDeliveryResponseError,
  liveQueryDeliveryResponseErrorToHttpError,
  LiveQueryDeliveryResponsePayloadError,
  liveQueryDeliveryResponsePayloadErrorToHttpError,
  type ClaimLiveQueryDeliveryBatchResult,
  type LiveQueryDeliveryCursor,
} from "../liveQueryDeliveryResponses";

export type DeliveryExecutorOperation = "claim" | "ack";

export type DeliveryExecutorFetch = (
  path: string,
  body: unknown,
) => Promise<Response>;

export type ClaimLiveQueryDeliveryBatchInput = {
  deploymentId: string;
  limit: number;
  leaseDurationMs: number;
  claimOwner: string;
  cursor: LiveQueryDeliveryCursor | undefined;
};

export type AckLiveQueryDeliveryBatchInput = {
  deploymentId: string;
  deliveryIds: string[];
  claimOwner: string;
};

export class DeliveryExecutorRequestError extends Data.TaggedError(
  "DeliveryExecutorRequestError",
)<{
  readonly operation: DeliveryExecutorOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type DeliveryExecutorBoundaryError =
  | DeliveryExecutorRequestError
  | LiveQueryDeliveryResponseError
  | LiveQueryDeliveryResponsePayloadError;

export const claimLiveQueryDeliveryBatchEffect = Effect.fn(
  "DeliveryExecutor.claimLiveQueryDeliveryBatch",
)(
  function* (
    executorFetch: DeliveryExecutorFetch,
    input: ClaimLiveQueryDeliveryBatchInput,
  ): Effect.fn.Return<
    ClaimLiveQueryDeliveryBatchResult,
    DeliveryExecutorBoundaryError
  > {
    const body = {
      deploymentId: input.deploymentId,
      limit: input.limit,
      leaseDurationMs: input.leaseDurationMs,
      claimOwner: input.claimOwner,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    };
    const response = yield* requestExecutor(
      executorFetch,
      "claim",
      "/maintenance/live-queries/claim",
      body,
    );
    const payload = yield* decodeLiveQueryDeliveryClaimResponse<unknown>(response);
    return yield* decodeLiveQueryDeliveryClaimPayload(payload);
  },
);

export const ackLiveQueryDeliveryBatchEffect = Effect.fn(
  "DeliveryExecutor.ackLiveQueryDeliveryBatch",
)(
  function* (
    executorFetch: DeliveryExecutorFetch,
    input: AckLiveQueryDeliveryBatchInput,
  ): Effect.fn.Return<{ delivered: number }, DeliveryExecutorBoundaryError> {
    const response = yield* requestExecutor(
      executorFetch,
      "ack",
      "/maintenance/live-queries/ack",
      {
        deploymentId: input.deploymentId,
        deliveryIds: input.deliveryIds,
        claimOwner: input.claimOwner,
      },
    );
    const payload = yield* decodeLiveQueryDeliveryAckResponse<unknown>(response);
    return yield* decodeLiveQueryDeliveryAckPayload(payload);
  },
);

export function isDeliveryExecutorBoundaryError(
  error: unknown,
): error is DeliveryExecutorBoundaryError {
  return error instanceof DeliveryExecutorRequestError ||
    error instanceof LiveQueryDeliveryResponseError ||
    error instanceof LiveQueryDeliveryResponsePayloadError;
}

export function deliveryExecutorBoundaryErrorToHttpError(
  error: DeliveryExecutorBoundaryError,
): HttpError {
  if (error instanceof DeliveryExecutorRequestError) {
    return new HttpError(error.status, error.message);
  }
  if (error instanceof LiveQueryDeliveryResponseError) {
    return liveQueryDeliveryResponseErrorToHttpError(error);
  }
  return liveQueryDeliveryResponsePayloadErrorToHttpError(error);
}

function requestExecutor(
  executorFetch: DeliveryExecutorFetch,
  operation: DeliveryExecutorOperation,
  path: string,
  body: unknown,
): Effect.Effect<Response, DeliveryExecutorRequestError> {
  return Effect.tryPromise({
    try: () => executorFetch(path, body),
    catch: error =>
      new DeliveryExecutorRequestError({
        operation,
        status: 500,
        message: errorMessage(error),
        cause: error,
      }),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
