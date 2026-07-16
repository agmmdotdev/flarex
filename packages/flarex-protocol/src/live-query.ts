import { Data, Effect, Schema } from "effect";
import { executionIdentityFingerprint } from "./auth";
import { isJson, type WritableJson } from "./json";

export type LiveQueryDeliveryJson = WritableJson;

export type LiveQueryDeliveryUpdatedChange = {
  kind: "updated";
  deploymentId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: LiveQueryDeliveryJson;
  identityFingerprint: string;
  resultJson: LiveQueryDeliveryJson;
  previousResultHash: string;
  resultHash: string;
};

export type LiveQueryDeliveryFailedChange = {
  kind: "failed";
  deploymentId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: LiveQueryDeliveryJson;
  identityFingerprint: string;
  previousResultHash: string;
  errorMessage: string;
  errorData: LiveQueryDeliveryJson | null;
};

export type LiveQueryDeliveryChange =
  | LiveQueryDeliveryUpdatedChange
  | LiveQueryDeliveryFailedChange;

export type LiveQueryDeliveryChangesBody = {
  deliveries: LiveQueryDeliveryChange[];
};

export type DeliveryWakeRequest = {
  deploymentId: string;
  limit?: number;
  maxBatches?: number;
  leaseDurationMs?: number;
};

export class LiveQueryDeliveryChangePayloadError extends Data.TaggedError(
  "LiveQueryDeliveryChangePayloadError",
)<{
  readonly message: string;
}> {}

export class DeliveryWakePayloadError extends Data.TaggedError("DeliveryWakePayloadError")<{
  readonly message: string;
}> {}

const LiveQueryDeliveryJsonValue = Schema.declare<LiveQueryDeliveryJson>(
  isLiveQueryDeliveryJson,
  {
    title: "LiveQueryDeliveryJson",
    description: "A JSON value used in live-query delivery callback payloads.",
  },
);
const ANONYMOUS_IDENTITY_FINGERPRINT = executionIdentityFingerprint({ kind: "anonymous" });

const LiveQueryDeliveryUpdatedChangeSchema = Schema.Struct({
  kind: Schema.Literal("updated"),
  deploymentId: Schema.String,
  connectionId: Schema.String,
  queryId: Schema.Number,
  functionPath: Schema.String,
  argsJson: LiveQueryDeliveryJsonValue,
  identityFingerprint: Schema.String,
  resultJson: LiveQueryDeliveryJsonValue,
  previousResultHash: Schema.String,
  resultHash: Schema.String,
});

const LiveQueryDeliveryFailedChangeSchema = Schema.Struct({
  kind: Schema.Literal("failed"),
  deploymentId: Schema.String,
  connectionId: Schema.String,
  queryId: Schema.Number,
  functionPath: Schema.String,
  argsJson: LiveQueryDeliveryJsonValue,
  identityFingerprint: Schema.String,
  previousResultHash: Schema.String,
  errorMessage: Schema.String,
  errorData: Schema.Union([LiveQueryDeliveryJsonValue, Schema.Null]),
});

export const LiveQueryDeliveryChangeSchema = Schema.Union([
  LiveQueryDeliveryUpdatedChangeSchema,
  LiveQueryDeliveryFailedChangeSchema,
]);

export const LiveQueryDeliveryChangesBodySchema = Schema.Struct({
  deliveries: Schema.Array(LiveQueryDeliveryChangeSchema),
});

export const DeliveryWakeRequestSchema = Schema.Struct({
  deploymentId: Schema.String,
  limit: Schema.optional(Schema.Number),
  maxBatches: Schema.optional(Schema.Number),
  leaseDurationMs: Schema.optional(Schema.Number),
});

const decodeUnknownLiveQueryDeliveryChangesBody = Schema.decodeUnknownEffect(
  LiveQueryDeliveryChangesBodySchema,
);
const decodeUnknownDeliveryWakeRequest = Schema.decodeUnknownEffect(
  DeliveryWakeRequestSchema,
);

export const decodeLiveQueryDeliveryChangesBodyEffect = Effect.fn(
  "LiveQueryProtocol.decodeDeliveryChangesBody",
)(function* (
  body: unknown,
): Effect.fn.Return<LiveQueryDeliveryChange[], LiveQueryDeliveryChangePayloadError> {
  const record = yield* liveQueryDeliveryRecord(
    body,
    "Live query delivery body must be an object with a deliveries array.",
  );
  if (!Array.isArray(record.deliveries)) {
    return yield* liveQueryDeliveryPayloadFailure(
      "Live query delivery body must be an object with a deliveries array.",
    );
  }
  const deliveries: LiveQueryDeliveryChange[] = [];
  for (const [index, value] of record.deliveries.entries()) {
    deliveries.push(yield* decodeLiveQueryDeliveryChange(value, `deliveries[${index}]`));
  }
  yield* decodeUnknownLiveQueryDeliveryChangesBody({ deliveries }).pipe(
    Effect.mapError(cause =>
      new LiveQueryDeliveryChangePayloadError({
        message: `Live query delivery body did not match the live-query protocol: ${String(cause)}`,
      })
    ),
  );
  return deliveries;
});

export const decodeDeliveryWakePayloadEffect = Effect.fn(
  "LiveQueryProtocol.decodeDeliveryWakePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
  return yield* decodeDeliveryWakePayloadWithDeploymentEffect(value);
});

export const decodePublicDeliveryWakePayloadEffect = Effect.fn(
  "LiveQueryProtocol.decodePublicDeliveryWakePayload",
)(function* (
  value: unknown,
  deploymentId: string,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return yield* deliveryWakePayloadFailure("Delivery wake request body must be an object.");
  }
  return yield* decodeDeliveryWakePayloadWithDeploymentEffect({
    ...(value as Record<string, unknown>),
    deploymentId,
  });
});

const decodeDeliveryWakePayloadWithDeploymentEffect = Effect.fn(
  "LiveQueryProtocol.decodeDeliveryWakePayloadWithDeployment",
)(function* (
  value: unknown,
): Effect.fn.Return<DeliveryWakeRequest, DeliveryWakePayloadError> {
  const record = yield* deliveryWakeRecord(value);
  const deploymentId = yield* requiredWakeString(record.deploymentId, "deploymentId");
  const limit = yield* optionalPositiveInteger(record.limit, "limit");
  const maxBatches = yield* optionalPositiveInteger(record.maxBatches, "maxBatches");
  const leaseDurationMs = yield* optionalPositiveInteger(
    record.leaseDurationMs,
    "leaseDurationMs",
  );
  const request: DeliveryWakeRequest = {
    deploymentId,
    ...(limit === undefined ? {} : { limit }),
    ...(maxBatches === undefined ? {} : { maxBatches }),
    ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
  };
  yield* decodeUnknownDeliveryWakeRequest(request).pipe(
    Effect.mapError(cause =>
      new DeliveryWakePayloadError({
        message: `Delivery wake request body did not match the live-query protocol: ${String(cause)}`,
      })
    ),
  );
  return request;
});

const decodeLiveQueryDeliveryChange = Effect.fn("LiveQueryProtocol.decodeDeliveryChange")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<LiveQueryDeliveryChange, LiveQueryDeliveryChangePayloadError> {
  const record = yield* liveQueryDeliveryRecord(value, `${path} must be an object.`);
  const kind = record.kind;
  if (kind === "failed") {
    return {
      kind: "failed",
      deploymentId: yield* requiredDeliveryString(record.deploymentId, `${path}.deploymentId`),
      connectionId: yield* requiredDeliveryString(record.connectionId, `${path}.connectionId`),
      queryId: yield* requiredDeliveryInteger(record.queryId, `${path}.queryId`),
      functionPath: yield* requiredDeliveryString(record.functionPath, `${path}.functionPath`),
      argsJson: yield* deliveryJson(record.argsJson, `${path}.argsJson`),
      identityFingerprint: yield* optionalDeliveryFingerprint(
        record.identityFingerprint,
        `${path}.identityFingerprint`,
      ),
      previousResultHash: yield* requiredDeliveryString(
        record.previousResultHash,
        `${path}.previousResultHash`,
      ),
      errorMessage: yield* requiredDeliveryString(record.errorMessage, `${path}.errorMessage`),
      errorData:
        record.errorData === undefined
          ? null
          : yield* deliveryJson(record.errorData, `${path}.errorData`),
    };
  }
  if (kind !== undefined && kind !== "updated") {
    return yield* liveQueryDeliveryPayloadFailure(
      `${path}.kind must be "updated" or "failed".`,
    );
  }
  return {
    kind: "updated",
    deploymentId: yield* requiredDeliveryString(record.deploymentId, `${path}.deploymentId`),
    connectionId: yield* requiredDeliveryString(record.connectionId, `${path}.connectionId`),
    queryId: yield* requiredDeliveryInteger(record.queryId, `${path}.queryId`),
    functionPath: yield* requiredDeliveryString(record.functionPath, `${path}.functionPath`),
    argsJson: yield* deliveryJson(record.argsJson, `${path}.argsJson`),
    identityFingerprint: yield* optionalDeliveryFingerprint(
      record.identityFingerprint,
      `${path}.identityFingerprint`,
    ),
    resultJson: yield* deliveryJson(record.resultJson, `${path}.resultJson`),
    previousResultHash: yield* requiredDeliveryString(
      record.previousResultHash,
      `${path}.previousResultHash`,
    ),
    resultHash: yield* requiredDeliveryString(record.resultHash, `${path}.resultHash`),
  };
});

function liveQueryDeliveryRecord(
  value: unknown,
  message: string,
): Effect.Effect<Record<string, unknown>, LiveQueryDeliveryChangePayloadError> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Effect.succeed(value as Record<string, unknown>);
  }
  return liveQueryDeliveryPayloadFailure(message);
}

function requiredDeliveryString(
  value: unknown,
  field: string,
): Effect.Effect<string, LiveQueryDeliveryChangePayloadError> {
  if (typeof value === "string" && value.length > 0) return Effect.succeed(value);
  return liveQueryDeliveryPayloadFailure(`${field} must be a non-empty string.`);
}

function requiredDeliveryInteger(
  value: unknown,
  field: string,
): Effect.Effect<number, LiveQueryDeliveryChangePayloadError> {
  if (typeof value === "number" && Number.isInteger(value)) return Effect.succeed(value);
  return liveQueryDeliveryPayloadFailure(`${field} must be an integer.`);
}

function optionalDeliveryFingerprint(
  value: unknown,
  field: string,
): Effect.Effect<string, LiveQueryDeliveryChangePayloadError> {
  if (value === undefined) return Effect.succeed(ANONYMOUS_IDENTITY_FINGERPRINT);
  return requiredDeliveryString(value, field);
}

function deliveryJson(
  value: unknown,
  field: string,
): Effect.Effect<LiveQueryDeliveryJson, LiveQueryDeliveryChangePayloadError> {
  if (isLiveQueryDeliveryJson(value)) return Effect.succeed(value);
  return liveQueryDeliveryPayloadFailure(`${field} must be a JSON value.`);
}

function liveQueryDeliveryPayloadFailure<A = never>(
  message: string,
): Effect.Effect<A, LiveQueryDeliveryChangePayloadError> {
  return Effect.fail(new LiveQueryDeliveryChangePayloadError({ message }));
}

function deliveryWakeRecord(
  value: unknown,
): Effect.Effect<Record<string, unknown>, DeliveryWakePayloadError> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Effect.succeed(value as Record<string, unknown>);
  }
  return deliveryWakePayloadFailure("Delivery wake request body must be an object.");
}

function requiredWakeString(
  value: unknown,
  field: string,
): Effect.Effect<string, DeliveryWakePayloadError> {
  if (typeof value === "string" && value.length > 0) return Effect.succeed(value);
  return deliveryWakePayloadFailure(`${field} must be a non-empty string.`);
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
): Effect.Effect<number | undefined, DeliveryWakePayloadError> {
  return value === undefined ? Effect.succeed(undefined) : positiveInteger(value, field);
}

function positiveInteger(
  value: unknown,
  field: string,
): Effect.Effect<number, DeliveryWakePayloadError> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Effect.succeed(value);
  }
  return deliveryWakePayloadFailure(`${field} must be a positive integer.`);
}

function deliveryWakePayloadFailure<A = never>(
  message: string,
): Effect.Effect<A, DeliveryWakePayloadError> {
  return Effect.fail(new DeliveryWakePayloadError({ message }));
}

function isLiveQueryDeliveryJson(value: unknown): value is LiveQueryDeliveryJson {
  return isJson(value);
}
