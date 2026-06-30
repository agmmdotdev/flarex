import { Data, Effect } from "effect";
import { HttpError } from "../http";
import {
  invalidSchedulerConnectionTarget,
  isSchedulerRuntimeError,
  schedulerRuntimeErrorToHttpError,
  type SchedulerRuntimeError,
} from "./RuntimeError";
import {
  decodeSchedulerForceReconnectJsonResponse,
  decodeSchedulerForceReconnectPayload,
  SchedulerResponseError,
  schedulerResponseErrorToHttpError,
  SchedulerResponsePayloadError,
  schedulerResponsePayloadErrorToHttpError,
} from "./Responses";

export type SchedulerForceReconnectInput = {
  connectionId: string;
  reason: string;
};

export type SchedulerForceReconnectResult = {
  ok: boolean;
  status: number;
  error: string;
  closed: number;
};

export type SchedulerForceReconnectFetch = (
  input: SchedulerForceReconnectInput,
) => Promise<Response>;

export class SchedulerForceReconnectRequestError extends Data.TaggedError(
  "SchedulerForceReconnectRequestError",
)<{
  readonly connectionId: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type SchedulerForceReconnectBoundaryError =
  | SchedulerForceReconnectRequestError
  | SchedulerRuntimeError
  | SchedulerResponseError
  | SchedulerResponsePayloadError;

export const forceReconnectEffect = Effect.fn(
  "SchedulerForceReconnect.forceReconnect",
)(
  function* (
    fetchReconnect: SchedulerForceReconnectFetch,
    input: SchedulerForceReconnectInput,
  ): Effect.fn.Return<
    SchedulerForceReconnectResult,
    SchedulerForceReconnectBoundaryError
  > {
    if (!input.connectionId.startsWith("connection:")) {
      return yield* Effect.fail(invalidSchedulerConnectionTarget(input.connectionId));
    }
    const response = yield* Effect.tryPromise({
      try: () => fetchReconnect(input),
      catch: cause =>
        new SchedulerForceReconnectRequestError({
          connectionId: input.connectionId,
          message: errorMessage(cause),
          cause,
        }),
    });
    if (!response.ok) {
      const error = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: cause =>
          new SchedulerForceReconnectRequestError({
            connectionId: input.connectionId,
            message: errorMessage(cause),
            cause,
          }),
      });
      return {
        ok: false,
        status: response.status,
        error,
        closed: 0,
      };
    }
    const payload = yield* decodeSchedulerForceReconnectJsonResponse<unknown>(
      response,
    );
    const result = yield* decodeSchedulerForceReconnectPayload(payload);
    return {
      ok: true,
      status: response.status,
      error: "",
      closed: result.closed,
    };
  },
);

export function isSchedulerForceReconnectBoundaryError(
  error: unknown,
): error is SchedulerForceReconnectBoundaryError {
  return (
    error instanceof SchedulerForceReconnectRequestError ||
    isSchedulerRuntimeError(error) ||
    error instanceof SchedulerResponseError ||
    error instanceof SchedulerResponsePayloadError
  );
}

export function schedulerForceReconnectBoundaryErrorToHttpError(
  error: SchedulerForceReconnectBoundaryError,
): HttpError {
  if (error instanceof SchedulerForceReconnectRequestError) {
    return new HttpError(500, error.message);
  }
  if (isSchedulerRuntimeError(error)) {
    return schedulerRuntimeErrorToHttpError(error);
  }
  if (error instanceof SchedulerResponseError) {
    return schedulerResponseErrorToHttpError(error);
  }
  return schedulerResponsePayloadErrorToHttpError(error);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
