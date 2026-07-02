import { HttpError } from "./http";
import { Data, Effect } from "effect";
import {
  decodeLiveQueryDeliveryChangesBodyEffect,
  LiveQueryDeliveryChangePayloadError,
  type LiveQueryDeliveryChange,
} from "flarex-protocol/live-query";
import {
  decodeConnectionLiveQueryDeliveryResponse,
  LiveQueryDeliveryResponseError,
  liveQueryDeliveryResponseErrorToHttpError,
} from "./liveQueryDeliveryResponses";
import type { Env } from "./types";

export {
  LiveQueryDeliveryChangePayloadError,
  type LiveQueryDeliveryChange,
} from "flarex-protocol/live-query";

const LIVE_QUERY_DELIVERY_SKIP_REASONS = [
  "wrongDeployment",
  "wrongConnection",
  "missingQuery",
  "stale",
  "unchanged",
] as const;

export type LiveQueryDeliverySkipReason = typeof LIVE_QUERY_DELIVERY_SKIP_REASONS[number];

export type LiveQueryDeliverySkipReasons = Partial<Record<LiveQueryDeliverySkipReason, number>>;

export function isLiveQueryDeliverySkipReason(value: string): value is LiveQueryDeliverySkipReason {
  return (LIVE_QUERY_DELIVERY_SKIP_REASONS as readonly string[]).includes(value);
}

export type LiveQueryDeliveryResult = {
  delivered: number;
  skipped: number;
  staleSkipped?: number;
  skipReasons?: LiveQueryDeliverySkipReasons;
};

export type ConnectionLiveQueryDeliveryResult = LiveQueryDeliveryResult & {
  connections: number;
};

export class LiveQueryDeliveryResultPayloadError extends Data.TaggedError(
  "LiveQueryDeliveryResultPayloadError",
)<{
  readonly connectionId: string;
  readonly status: number;
  readonly message: string;
}> {}

export class LiveQueryDeliveryTargetError extends Data.TaggedError(
  "LiveQueryDeliveryTargetError",
)<{
  readonly deploymentId: string;
  readonly deliveryDeploymentId: string;
  readonly connectionId: string;
  readonly message: string;
}> {}

export class LiveQueryDeliveryConnectionFetchError extends Data.TaggedError(
  "LiveQueryDeliveryConnectionFetchError",
)<{
  readonly connectionId: string;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type LiveQueryDeliveryFanoutError =
  | LiveQueryDeliveryTargetError
  | LiveQueryDeliveryConnectionFetchError
  | LiveQueryDeliveryResponseError
  | LiveQueryDeliveryResultPayloadError;

export function liveQueryDeliveryChangesFromBody(
  body: unknown,
): LiveQueryDeliveryChange[] {
  return Effect.runSync(decodeLiveQueryDeliveryChangesBodyEffect(body));
}

export const decodeLiveQueryDeliveryChangesFromBody = Effect.fn(
  "LiveQueryDelivery.decodeChangesFromBody",
)(
  function* (
    body: unknown,
  ): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
    return yield* decodeLiveQueryDeliveryChangesBodyEffect(body);
  },
);

export function liveQueryDeliveryChangePayloadErrorToHttpError(
  error: LiveQueryDeliveryChangePayloadError,
): HttpError {
  return new HttpError(400, error.message);
}

export const liveQueryDeliveryChangePayloadErrorToHttpErrorEffect = Effect.fn(
  "LiveQueryDelivery.changePayloadErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryChangePayloadError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(liveQueryDeliveryChangePayloadErrorToHttpError(error));
});

export async function deliverLiveQueryChangesToConnections(
  env: Env,
  deploymentId: string,
  deliveries: LiveQueryDeliveryChange[],
): Promise<ConnectionLiveQueryDeliveryResult> {
  // Deliberate runtime bridge: live-query delivery fanout API is Promise-based.
  return await Effect.runPromise(
    deliverLiveQueryChangesToConnectionsEffect(env, deploymentId, deliveries).pipe(
      Effect.catch(liveQueryDeliveryFanoutErrorToHttpErrorEffect),
    ),
  );
}

export const deliverLiveQueryChangesToConnectionsEffect = Effect.fn(
  "LiveQueryDelivery.deliverToConnections",
)(
  function* (
    env: Env,
    deploymentId: string,
    deliveries: LiveQueryDeliveryChange[],
  ): Effect.fn.Return<
    ConnectionLiveQueryDeliveryResult,
    LiveQueryDeliveryFanoutError
  > {
    const byConnection = yield* liveQueryDeliveriesByConnection(deploymentId, deliveries);
    let delivered = 0;
    let skipped = 0;
    const skipReasons: LiveQueryDeliverySkipReasons = {};
    for (const [connectionId, connectionDeliveries] of byConnection) {
      const response = yield* Effect.tryPromise({
        try: () =>
          env.CONNECTIONS.getByName(connectionId).fetch(
            "https://flarex.internal/deliver/live-query",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ deliveries: connectionDeliveries }),
            },
          ),
        catch: error => new LiveQueryDeliveryConnectionFetchError({
          connectionId,
          status: 500,
          message: errorMessage(error),
          cause: error,
        }),
      });
      const body = yield* decodeConnectionLiveQueryDeliveryResponse<unknown>(
        response,
        connectionId,
      );
      const result = yield* decodeConnectionLiveQueryDeliveryResultPayload(
        body,
        connectionId,
      );
      delivered += result.delivered;
      skipped += result.skipped;
      addLiveQueryDeliverySkipReasons(skipReasons, result.skipReasons);
    }

    return {
      delivered,
      skipped,
      ...liveQueryDeliverySkipMetadata(skipReasons),
      connections: byConnection.size,
    };
  },
);

export const liveQueryDeliveriesByConnection = Effect.fn(
  "LiveQueryDelivery.groupByConnection",
)(
  function* (
    deploymentId: string,
    deliveries: LiveQueryDeliveryChange[],
  ): Effect.fn.Return<
    Map<string, LiveQueryDeliveryChange[]>,
    LiveQueryDeliveryTargetError
  > {
    const byConnection = new Map<string, LiveQueryDeliveryChange[]>();
    for (const delivery of deliveries) {
      yield* validateLiveQueryDeliveryTarget(deploymentId, delivery);
      const existing = byConnection.get(delivery.connectionId);
      if (existing === undefined) {
        byConnection.set(delivery.connectionId, [delivery]);
      } else {
        existing.push(delivery);
      }
    }
    return byConnection;
  },
);

export function addLiveQueryDeliverySkipReason(
  reasons: LiveQueryDeliverySkipReasons,
  reason: LiveQueryDeliverySkipReason,
): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export function addLiveQueryDeliverySkipReasons(
  target: LiveQueryDeliverySkipReasons,
  source: LiveQueryDeliverySkipReasons | undefined,
): void {
  if (source === undefined) return;
  for (const reason of LIVE_QUERY_DELIVERY_SKIP_REASONS) {
    const count = source[reason];
    if (count === undefined) continue;
    target[reason] = (target[reason] ?? 0) + count;
  }
}

export function liveQueryDeliverySkipMetadata(
  reasons: LiveQueryDeliverySkipReasons,
): Pick<LiveQueryDeliveryResult, "staleSkipped" | "skipReasons"> {
  const skipReasons = nonZeroLiveQueryDeliverySkipReasons(reasons);
  if (skipReasons === undefined) return {};
  return {
    ...(skipReasons.stale === undefined ? {} : { staleSkipped: skipReasons.stale }),
    skipReasons,
  };
}

function validateLiveQueryDeliveryTarget(
  deploymentId: string,
  delivery: LiveQueryDeliveryChange,
): Effect.Effect<void, LiveQueryDeliveryTargetError> {
  if (delivery.deploymentId !== deploymentId) {
    return Effect.fail(new LiveQueryDeliveryTargetError({
      deploymentId,
      deliveryDeploymentId: delivery.deploymentId,
      connectionId: delivery.connectionId,
      message: `Live query delivery deploymentId ${delivery.deploymentId} does not match route deploymentId ${deploymentId}.`,
    }));
  }
  if (!delivery.connectionId.startsWith(`connection:${deploymentId}:`)) {
    return Effect.fail(new LiveQueryDeliveryTargetError({
      deploymentId,
      deliveryDeploymentId: delivery.deploymentId,
      connectionId: delivery.connectionId,
      message: `Live query delivery connectionId ${delivery.connectionId} is not scoped to deployment ${deploymentId}.`,
    }));
  }
  return Effect.void;
}

export function liveQueryDeliveryResultFromUnknown(
  value: unknown,
  connectionId: string,
): LiveQueryDeliveryResult {
  return Effect.runSync(
    decodeConnectionLiveQueryDeliveryResultPayload(value, connectionId).pipe(
      Effect.catch(liveQueryDeliveryResultPayloadErrorToHttpErrorEffect),
    ),
  );
}

export const decodeConnectionLiveQueryDeliveryResultPayload = Effect.fn(
  "LiveQueryDelivery.decodeConnectionResultPayload",
)(
  function* (
    value: unknown,
    connectionId: string,
  ): Effect.fn.Return<LiveQueryDeliveryResult, LiveQueryDeliveryResultPayloadError> {
    const record = yield* resultRecord(value, connectionId);
    const skipReasons = yield* optionalLiveQueryDeliverySkipReasons(
      record.skipReasons,
      `${connectionId}.skipReasons`,
      connectionId,
    );
    const staleSkipped = yield* optionalResultInteger(
      record.staleSkipped,
      `${connectionId}.staleSkipped`,
      connectionId,
    );
    if (
      staleSkipped !== undefined &&
      skipReasons?.stale !== undefined &&
      staleSkipped !== skipReasons.stale
    ) {
      return yield* failResultPayload(
        connectionId,
        `${connectionId}.staleSkipped must match ${connectionId}.skipReasons.stale when both are present.`,
      );
    }
    const parsedStaleSkipped = staleSkipped ?? skipReasons?.stale;
    const parsedSkipReasons = normalizeParsedSkipReasons(skipReasons, staleSkipped);
    return {
      delivered: yield* requiredResultInteger(
        record.delivered,
        `${connectionId}.delivered`,
        connectionId,
      ),
      skipped: yield* requiredResultInteger(
        record.skipped,
        `${connectionId}.skipped`,
        connectionId,
      ),
      ...(parsedStaleSkipped === undefined ? {} : { staleSkipped: parsedStaleSkipped }),
      ...(parsedSkipReasons === undefined ? {} : { skipReasons: parsedSkipReasons }),
    };
  },
);

export function liveQueryDeliveryResultPayloadErrorToHttpError(
  error: LiveQueryDeliveryResultPayloadError,
): HttpError {
  return new HttpError(error.status, error.message);
}

export const liveQueryDeliveryResultPayloadErrorToHttpErrorEffect = Effect.fn(
  "LiveQueryDelivery.resultPayloadErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryResultPayloadError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(liveQueryDeliveryResultPayloadErrorToHttpError(error));
});

export function liveQueryDeliveryTargetErrorToHttpError(
  error: LiveQueryDeliveryTargetError,
): HttpError {
  return new HttpError(400, error.message);
}

export const liveQueryDeliveryTargetErrorToHttpErrorEffect = Effect.fn(
  "LiveQueryDelivery.targetErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryTargetError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(liveQueryDeliveryTargetErrorToHttpError(error));
});

export function liveQueryDeliveryFanoutErrorToHttpError(
  error: LiveQueryDeliveryFanoutError,
): HttpError {
  if (error instanceof LiveQueryDeliveryTargetError) {
    return liveQueryDeliveryTargetErrorToHttpError(error);
  }
  if (error instanceof LiveQueryDeliveryConnectionFetchError) {
    return new HttpError(error.status, error.message);
  }
  if (error instanceof LiveQueryDeliveryResponseError) {
    return liveQueryDeliveryResponseErrorToHttpError(error);
  }
  return liveQueryDeliveryResultPayloadErrorToHttpError(error);
}

export const liveQueryDeliveryFanoutErrorToHttpErrorEffect = Effect.fn(
  "LiveQueryDelivery.fanoutErrorToHttpError",
)(function* (
  error: LiveQueryDeliveryFanoutError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(liveQueryDeliveryFanoutErrorToHttpError(error));
});

export function isLiveQueryDeliveryFanoutError(
  error: unknown,
): error is LiveQueryDeliveryFanoutError {
  return error instanceof LiveQueryDeliveryTargetError ||
    error instanceof LiveQueryDeliveryConnectionFetchError ||
    error instanceof LiveQueryDeliveryResponseError ||
    error instanceof LiveQueryDeliveryResultPayloadError;
}

function resultRecord(
  value: unknown,
  connectionId: string,
): Effect.Effect<Record<string, unknown>, LiveQueryDeliveryResultPayloadError> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Effect.succeed(value as Record<string, unknown>);
  }
  return failResultPayload(
    connectionId,
    `ConnectionDO live query delivery for ${connectionId} did not return a JSON object.`,
  );
}

function requiredResultInteger(
  value: unknown,
  field: string,
  connectionId: string,
): Effect.Effect<number, LiveQueryDeliveryResultPayloadError> {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Effect.succeed(value);
  }
  return failResultPayload(connectionId, `${field} must be a non-negative integer.`);
}

function optionalResultInteger(
  value: unknown,
  field: string,
  connectionId: string,
): Effect.Effect<number | undefined, LiveQueryDeliveryResultPayloadError> {
  if (value === undefined) return Effect.succeed(undefined);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Effect.succeed(value);
  }
  return failResultPayload(
    connectionId,
    `${field} must be a non-negative integer when present.`,
  );
}

function nonZeroLiveQueryDeliverySkipReasons(
  reasons: LiveQueryDeliverySkipReasons,
): LiveQueryDeliverySkipReasons | undefined {
  const result: LiveQueryDeliverySkipReasons = {};
  for (const reason of LIVE_QUERY_DELIVERY_SKIP_REASONS) {
    const count = reasons[reason];
    if (count === undefined || count === 0) continue;
    result[reason] = count;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function optionalLiveQueryDeliverySkipReasons(
  value: unknown,
  field: string,
  connectionId: string,
): Effect.Effect<LiveQueryDeliverySkipReasons | undefined, LiveQueryDeliveryResultPayloadError> {
  if (value === undefined) return Effect.succeed(undefined);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failResultPayload(connectionId, `${field} must be an object when present.`);
  }
  return Effect.gen(function* () {
    const record = value as Record<string, unknown>;
    const result: LiveQueryDeliverySkipReasons = {};
    for (const reason of LIVE_QUERY_DELIVERY_SKIP_REASONS) {
      const count = yield* optionalResultInteger(
        record[reason],
        `${field}.${reason}`,
        connectionId,
      );
      if (count === undefined) continue;
      result[reason] = count;
    }
    return nonZeroLiveQueryDeliverySkipReasons(result);
  });
}

function normalizeParsedSkipReasons(
  skipReasons: LiveQueryDeliverySkipReasons | undefined,
  staleSkipped: number | undefined,
): LiveQueryDeliverySkipReasons | undefined {
  if (skipReasons === undefined) {
    return staleSkipped === undefined ? undefined : { stale: staleSkipped };
  }
  if (staleSkipped === undefined || skipReasons.stale !== undefined) return skipReasons;
  return {
    ...skipReasons,
    stale: staleSkipped,
  };
}

function failResultPayload<A = never>(
  connectionId: string,
  message: string,
): Effect.Effect<A, LiveQueryDeliveryResultPayloadError> {
  return Effect.fail(new LiveQueryDeliveryResultPayloadError({
    connectionId,
    status: 502,
    message,
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
