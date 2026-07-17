import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";
import { HttpError } from "../http";
import { isLiveQueryDeliverySkipReason } from "../liveQueryDelivery";
import type { DeliveryDrainFailureResult } from "../deliveryDO";
import {
  decodeSchedulerWakeDeliveryJsonResponse,
  SchedulerResponseError,
  schedulerResponseErrorToHttpError,
} from "./Responses";

export type SchedulerDeliveryWakeInput = {
  deploymentId: string;
  limit: number;
  maxBatches?: number;
};

export type SchedulerDeliveryWakeResult = {
  woken: boolean;
  status: number | null;
  result: unknown;
  error: string | null;
  failure?: DeliveryDrainFailureResult["failure"];
};

export type SchedulerDeliveryWakeFetch = (
  input: SchedulerDeliveryWakeInput,
) => Promise<Response>;

export class SchedulerDeliveryWakeRequestError extends Data.TaggedError(
  "SchedulerDeliveryWakeRequestError",
)<{
  readonly deploymentId: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type SchedulerDeliveryWakeBoundaryError =
  | SchedulerDeliveryWakeRequestError
  | SchedulerResponseError;

export const wakeDeliveryEffect = Effect.fn("SchedulerDeliveryWake.wakeDelivery")(
  function* (
    fetchWake: SchedulerDeliveryWakeFetch,
    input: SchedulerDeliveryWakeInput,
  ): Effect.fn.Return<SchedulerDeliveryWakeResult, SchedulerDeliveryWakeBoundaryError> {
    const response = yield* Effect.tryPromise({
      try: () => fetchWake(input),
      catch: cause =>
        new SchedulerDeliveryWakeRequestError({
          deploymentId: input.deploymentId,
          message: errorMessage(cause),
          cause,
        }),
    });
    if (!response.ok) {
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: cause =>
          new SchedulerDeliveryWakeRequestError({
            deploymentId: input.deploymentId,
            message: errorMessage(cause),
            cause,
          }),
      });
      const result = yield* decodeSchedulerDeliveryWakeFailureBodyText(text);
      if (isDeliveryDrainFailureResult(result)) {
        return {
          woken: false,
          status: response.status,
          result,
          error: result.error,
          failure: result.failure,
        };
      }
      return {
        woken: false,
        status: response.status,
        result,
        error: responseBodyError(result),
      };
    }
    const result = yield* decodeSchedulerWakeDeliveryJsonResponse(
      response,
    );
    return {
      woken: true,
      status: response.status,
      result,
      error: null,
    };
  },
);

export function isSchedulerDeliveryWakeBoundaryError(
  error: unknown,
): error is SchedulerDeliveryWakeBoundaryError {
  return error instanceof SchedulerDeliveryWakeRequestError ||
    error instanceof SchedulerResponseError;
}

export const decodeSchedulerDeliveryWakeFailureBodyText = Effect.fn(
  "SchedulerDeliveryWake.decodeFailureBodyText",
)(function* (
  text: string,
): Effect.fn.Return<unknown> {
  if (text.length === 0) return null;
  return yield* Effect.try({
    // Deliberate JSON bridge: wake failure bodies may be plain text fallback.
    try: () => JSON.parse(text) as unknown,
    catch: () => text,
  }).pipe(
    Effect.catch((fallback: string) => Effect.succeed(fallback)),
  );
});

export function schedulerDeliveryWakeBoundaryErrorToHttpError(
  error: SchedulerDeliveryWakeBoundaryError,
): HttpError {
  if (error instanceof SchedulerDeliveryWakeRequestError) {
    return new HttpError(500, error.message);
  }
  return schedulerResponseErrorToHttpError(error);
}

export function isDeliveryDrainFailureResult(
  value: unknown,
): value is DeliveryDrainFailureResult {
  if (!isNonArrayRecord(value)) {
    return false;
  }
  const record = value;
  const failure = record.failure;
  const summary = record.summary;
  return (
    typeof record.deploymentId === "string" &&
    typeof record.error === "string" &&
    isDeliveryDrainFailureDetail(failure) &&
    record.error === failure.error &&
    isDeliveryDrainFailureSummary(summary) &&
    deliveryDrainFailureDetailsMatch(failure, summary.failure)
  );
}

function responseBodyError(value: unknown): string {
  if (isNonArrayRecord(value)) {
    const error = value.error;
    if (typeof error === "string") return error;
  }
  if (typeof value === "string") return value;
  if (value === null) return "Delivery wake failed without an error body.";
  return JSON.stringify(value) ?? String(value);
}

function isDeliveryDrainFailureSummary(
  value: unknown,
): value is DeliveryDrainFailureResult["summary"] {
  if (!isNonArrayRecord(value)) {
    return false;
  }
  const record = value;
  const skipReasons = record.skipReasons;
  const staleSkipped = record.staleSkipped;
  return (
    isNonNegativeInteger(record.batches) &&
    deliveryPendingAckMatches(record.claimed, record.acked, record.pendingAck) &&
    isNonNegativeInteger(record.delivered) &&
    isNonNegativeInteger(record.skipped) &&
    (staleSkipped === undefined || isNonNegativeInteger(staleSkipped)) &&
    isOptionalDeliverySkipReasons(skipReasons) &&
    deliveryStaleSkippedMatchesSkipReason(staleSkipped, skipReasons) &&
    typeof record.hasMore === "boolean" &&
    isDeliveryDrainFailureDetail(record.failure)
  );
}

function isDeliveryDrainFailureDetail(
  value: unknown,
): value is DeliveryDrainFailureResult["failure"] {
  if (!isNonArrayRecord(value)) {
    return false;
  }
  const record = value;
  return (
    (
      record.stage === "claim" ||
      record.stage === "fanout" ||
      record.stage === "ack"
    ) &&
    isHttpStatus(record.status) &&
    typeof record.error === "string"
  );
}

function deliveryDrainFailureDetailsMatch(
  left: DeliveryDrainFailureResult["failure"],
  right: DeliveryDrainFailureResult["failure"],
): boolean {
  return left.stage === right.stage && left.status === right.status && left.error === right.error;
}

function isOptionalDeliverySkipReasons(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isNonArrayRecord(value)) {
    return false;
  }
  const record = value;
  return (
    Object.keys(record).every(isLiveQueryDeliverySkipReason) &&
    isOptionalNonNegativeInteger(record.wrongDeployment) &&
    isOptionalNonNegativeInteger(record.wrongConnection) &&
    isOptionalNonNegativeInteger(record.missingQuery) &&
    isOptionalNonNegativeInteger(record.stale) &&
    isOptionalNonNegativeInteger(record.unchanged)
  );
}

function deliveryStaleSkippedMatchesSkipReason(
  staleSkipped: unknown,
  skipReasons: unknown,
): boolean {
  if (
    staleSkipped === undefined ||
    !isNonArrayRecord(skipReasons)
  ) {
    return true;
  }
  const staleSkipReason = skipReasons.stale;
  return staleSkipReason === undefined || staleSkipReason === staleSkipped;
}

function deliveryPendingAckMatches(
  claimed: unknown,
  acked: unknown,
  pendingAck: unknown,
): boolean {
  return (
    isNonNegativeInteger(claimed) &&
    isNonNegativeInteger(acked) &&
    isNonNegativeInteger(pendingAck) &&
    pendingAck === Math.max(0, claimed - acked)
  );
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
