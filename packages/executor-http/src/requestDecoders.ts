import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { Effect, Result } from "effect";
import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { decodeExecutionIdentityEffect } from "flarex-protocol/auth";
import {
  isJson as isProtocolJson,
  isJsonObject,
  type JsonObject,
} from "flarex-protocol/json";
import type {
  AbortInvokeSessionInput,
  AbortStaleInvokeSessionsInput,
  AckLiveQueryDeliveriesInput,
  BeginInvokeSessionInput,
  ClaimLiveQueryDeliveryBatchInput,
  DeadLetterStuckLiveQueryDeliveriesInput,
  FinishInvokeSessionInput,
  FunctionVisibility,
  InvokableFunctionKind,
  InvokeSyscallInput,
  InvokeSyscallRequest,
  Json,
  ListExpiredLiveQueryConnectionDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListStuckLiveQueryDeliveriesInput,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  PrepareInvokeInput,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQuerySubscriptionInput,
  RemoveExpiredLiveQuerySubscriptionsInput,
  RemoveLiveQuerySubscriptionInput,
  RemoveLiveQuerySubscriptionsForConnectionInput,
  RunInvokeSessionMaintenanceInput,
  TouchLiveQueryConnectionInput,
} from "@flarex/executor";
import {
  type BadRequestBody,
  ExecutorHttpBodyValidationError,
  ExecutorHttpJsonBodyError,
} from "./errors";

type ExecutorHttpParseResult<A> = Result.Result<A, BadRequestBody>;

export type ExecutorHttpBodyDecoder<A> = (
  body: unknown,
) => Effect.Effect<A, ExecutorHttpBodyValidationError>;

type ExecutorHttpBodyValidationEffect<A> = Effect.Effect<
  A,
  ExecutorHttpBodyValidationError
>;

type LiveQueryRerunMaintenanceBody = {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly limit?: number;
};

type LiveQueryDeliveryMaintenanceBody = {
  readonly deploymentId: string;
  readonly limit?: number;
};

export function readExecutorHttpJsonBody(
  request: Request,
): Effect.Effect<unknown, ExecutorHttpJsonBodyError> {
  return Effect.tryPromise({
    // Deliberate JSON bridge: Request.json is the HTTP host boundary.
    // SAFETY: the promise resolves to the parsed JSON body, which this
    // boundary intentionally leaves unknown for domain decoders to own.
    try: () => request.json() as Promise<unknown>,
    catch: cause => new ExecutorHttpJsonBodyError({
      message: "Request body must be valid JSON.",
      cause,
    }),
  });
}

function decodeExecutorHttpValidationResult<A>(
  result: ExecutorHttpParseResult<A>,
): ExecutorHttpBodyValidationEffect<A> {
  return Effect.fromResult(result).pipe(
    Effect.mapError(body => new ExecutorHttpBodyValidationError({ body })),
  );
}

export const decodePrepareInvokeBody = Effect.fn("ExecutorHttp.decodePrepareInvokeBody")(
  (body: unknown) => parsePrepareInvokeBody(body),
);

export const decodeBeginInvokeSessionBody = Effect.fn(
  "ExecutorHttp.decodeBeginInvokeSessionBody",
)(
  (body: unknown) => parseBeginInvokeSessionBody(body),
);

export const decodeInvokeSyscallBody = Effect.fn("ExecutorHttp.decodeInvokeSyscallBody")(
  (body: unknown) => parseInvokeSyscallBody(body),
);

export const decodeInvokeFinishBody = Effect.fn("ExecutorHttp.decodeInvokeFinishBody")(
  (body: unknown) => parseInvokeFinishBody(body),
);

export const decodeInvokeAbortBody = Effect.fn("ExecutorHttp.decodeInvokeAbortBody")(
  (body: unknown) => parseInvokeAbortBody(body),
);

export const decodeInvokeAbortStaleBody = Effect.fn(
  "ExecutorHttp.decodeInvokeAbortStaleBody",
)(
  (body: unknown) => parseInvokeAbortStaleBody(body),
);

export const decodeInvokeSessionMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeInvokeSessionMaintenanceBody",
)(
  (body: unknown) => parseInvokeSessionMaintenanceBody(body),
);

export const decodeLiveQueryRerunMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryRerunMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryRerunMaintenanceBody(body),
);

export const decodeLiveQueryDeliveryMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryDeliveryMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryDeliveryMaintenanceBody(body),
);

export const decodeLiveQuerySubscriptionRecordBody = Effect.fn(
  "ExecutorHttp.decodeLiveQuerySubscriptionRecordBody",
)(
  (body: unknown) => parseLiveQuerySubscriptionRecordBody(body),
);

export const decodeLiveQuerySubscriptionRemoveBody = Effect.fn(
  "ExecutorHttp.decodeLiveQuerySubscriptionRemoveBody",
)(
  (body: unknown) => parseLiveQuerySubscriptionRemoveBody(body),
);

export const decodeLiveQueryConnectionTouchBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryConnectionTouchBody",
)(
  (body: unknown) => parseLiveQueryConnectionTouchBody(body),
);

export const decodeLiveQuerySubscriptionRemoveConnectionBody = Effect.fn(
  "ExecutorHttp.decodeLiveQuerySubscriptionRemoveConnectionBody",
)(
  (body: unknown) => parseLiveQuerySubscriptionRemoveConnectionBody(body),
);

export const decodeLiveQueryConnectionCleanupBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryConnectionCleanupBody",
)(
  (body: unknown) => parseLiveQueryConnectionCleanupBody(body),
);

export const decodeLiveQueryClaimMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryClaimMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryClaimMaintenanceBody(body),
);

export const decodeLiveQueryAckMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryAckMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryAckMaintenanceBody(body),
);

export const decodeLiveQueryFailureMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryFailureMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryFailureMaintenanceBody(body),
);

export const decodeLiveQueryDeadLetterMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryDeadLetterMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryDeadLetterMaintenanceBody(body),
);

export const decodeLiveQueryDeadLetterStuckMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryDeadLetterStuckMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryDeadLetterStuckMaintenanceBody(body),
);

export const decodeLiveQueryPendingDeploymentsMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryPendingDeploymentsMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryPendingDeploymentsMaintenanceBody(body),
);

export const decodeLiveQueryExpiredConnectionDeploymentsMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryExpiredConnectionDeploymentsMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryExpiredConnectionDeploymentsMaintenanceBody(body),
);

export const decodeLiveQueryStuckDeliveriesMaintenanceBody = Effect.fn(
  "ExecutorHttp.decodeLiveQueryStuckDeliveriesMaintenanceBody",
)(
  (body: unknown) => parseLiveQueryStuckDeliveriesMaintenanceBody(body),
);

function parsePrepareInvokeBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<PrepareInvokeInput> {
  return decodeExecutorHttpValidationResult(parsePrepareInvokeBodyResult(body));
}

function parseBeginInvokeSessionBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<BeginInvokeSessionInput> {
  return Effect.gen(function* () {
    const parsed = yield* decodeExecutorHttpValidationResult(
      parseBeginInvokeSessionBodyResult(body),
    );
    if (!isNonArrayRecord(body)) {
      return parsed;
    }
    const record = body;
    if (!("identity" in record)) {
      return parsed;
    }
    const identity = yield* decodeExecutionIdentityEffect(record.identity).pipe(
      Effect.mapError(() =>
        new ExecutorHttpBodyValidationError({
          body: {
            error: "bad_request",
            message: "Execution identity must be anonymous or include a valid user identity.",
          },
        })
      ),
    );
    return { ...parsed, identity };
  });
}

function parseInvokeSyscallBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<InvokeSyscallInput> {
  return decodeExecutorHttpValidationResult(parseInvokeSyscallBodyResult(body));
}

function parseInvokeFinishBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<FinishInvokeSessionInput> {
  return decodeExecutorHttpValidationResult(parseInvokeFinishBodyResult(body));
}

function parseInvokeAbortBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<AbortInvokeSessionInput> {
  return decodeExecutorHttpValidationResult(parseInvokeAbortBodyResult(body));
}

function parseInvokeAbortStaleBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<AbortStaleInvokeSessionsInput> {
  return decodeExecutorHttpValidationResult(parseInvokeAbortStaleBodyResult(body));
}

function parseInvokeSessionMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<RunInvokeSessionMaintenanceInput> {
  return decodeExecutorHttpValidationResult(parseInvokeSessionMaintenanceBodyResult(body));
}

function parseLiveQueryRerunMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<LiveQueryRerunMaintenanceBody> {
  return decodeExecutorHttpValidationResult(parseLiveQueryRerunMaintenanceBodyResult(body));
}

function parseLiveQueryDeliveryMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<LiveQueryDeliveryMaintenanceBody> {
  return decodeExecutorHttpValidationResult(parseLiveQueryDeliveryMaintenanceBodyResult(body));
}

function parseLiveQuerySubscriptionRecordBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<RecordLiveQuerySubscriptionInput> {
  return Effect.gen(function* () {
    const parsed = yield* decodeExecutorHttpValidationResult(
      parseLiveQuerySubscriptionRecordBodyResult(body),
    );
    if (!isNonArrayRecord(body)) {
      return parsed;
    }
    const record = body;
    if (!("identity" in record)) {
      return parsed;
    }
    const identity = yield* decodeExecutionIdentityEffect(record.identity).pipe(
      Effect.mapError(() =>
        new ExecutorHttpBodyValidationError({
          body: {
            error: "bad_request",
            message: "Execution identity must be anonymous or include a valid user identity.",
          },
        })
      ),
    );
    return { ...parsed, identity };
  });
}

function parseLiveQuerySubscriptionRemoveBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<RemoveLiveQuerySubscriptionInput> {
  return decodeExecutorHttpValidationResult(parseLiveQuerySubscriptionRemoveBodyResult(body));
}

function parseLiveQueryConnectionTouchBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<TouchLiveQueryConnectionInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryConnectionTouchBodyResult(body));
}

function parseLiveQuerySubscriptionRemoveConnectionBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<RemoveLiveQuerySubscriptionsForConnectionInput> {
  return decodeExecutorHttpValidationResult(parseLiveQuerySubscriptionRemoveConnectionBodyResult(body));
}

function parseLiveQueryConnectionCleanupBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<RemoveExpiredLiveQuerySubscriptionsInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryConnectionCleanupBodyResult(body));
}

function parseLiveQueryClaimMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<ClaimLiveQueryDeliveryBatchInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryClaimMaintenanceBodyResult(body));
}

function parseLiveQueryAckMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<AckLiveQueryDeliveriesInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryAckMaintenanceBodyResult(body));
}

function parseLiveQueryFailureMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<RecordLiveQueryDeliveryFailureInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryFailureMaintenanceBodyResult(body));
}

function parseLiveQueryDeadLetterMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<MarkLiveQueryDeliveriesDeadLetteredInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryDeadLetterMaintenanceBodyResult(body));
}

function parseLiveQueryDeadLetterStuckMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<DeadLetterStuckLiveQueryDeliveriesInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryDeadLetterStuckMaintenanceBodyResult(body));
}

function parseLiveQueryPendingDeploymentsMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<ListPendingLiveQueryDeliveryDeploymentsInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryPendingDeploymentsMaintenanceBodyResult(body));
}

function parseLiveQueryExpiredConnectionDeploymentsMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<ListExpiredLiveQueryConnectionDeploymentsInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryExpiredConnectionDeploymentsMaintenanceBodyResult(body));
}

function parseLiveQueryStuckDeliveriesMaintenanceBody(
  body: unknown,
): ExecutorHttpBodyValidationEffect<ListStuckLiveQueryDeliveriesInput> {
  return decodeExecutorHttpValidationResult(parseLiveQueryStuckDeliveriesMaintenanceBodyResult(body));
}

// These result helpers preserve the exact legacy bad-request messages while
// route-facing decoders expose tagged Effect failures.
function parsePrepareInvokeBodyResult(
  body: unknown,
): ExecutorHttpParseResult<PrepareInvokeInput> {
  return parseInvokeBodyResult(body, { includeIdempotencyKey: false });
}

function parseBeginInvokeSessionBodyResult(
  body: unknown,
): ExecutorHttpParseResult<BeginInvokeSessionInput> {
  return parseInvokeBodyResult(body, { includeIdempotencyKey: true });
}

function parseInvokeBodyResult(
  body: unknown,
  options: { includeIdempotencyKey: false },
): ExecutorHttpParseResult<PrepareInvokeInput>;
function parseInvokeBodyResult(
  body: unknown,
  options: { includeIdempotencyKey: true },
): ExecutorHttpParseResult<BeginInvokeSessionInput>;
function parseInvokeBodyResult(
  body: unknown,
  options: { includeIdempotencyKey: boolean },
): ExecutorHttpParseResult<BeginInvokeSessionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const path = yield* requiredString(record, "path");
    const kind = yield* optionalInvokableKind(record.kind);
    const visibility = yield* optionalFunctionVisibility(record.visibility);
    const args = yield* jsonValue(record.args, "args");
    const partitionKey = yield* optionalString(record.partitionKey, "partitionKey");
    const idempotencyKey = yield* optionalString(
      record.idempotencyKey,
      "idempotencyKey",
    );

    return {
      deploymentId,
      projectId,
      path,
      ...(kind === undefined ? {} : { kind }),
      ...(visibility === undefined ? {} : { visibility }),
      args,
      ...(partitionKey === undefined
        ? {}
        : { partitionKey }),
      ...(options.includeIdempotencyKey && idempotencyKey !== undefined
        ? { idempotencyKey }
        : {}),
    };
  });
}

function parseInvokeSyscallBodyResult(
  body: unknown,
): ExecutorHttpParseResult<InvokeSyscallInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const sessionId = yield* requiredString(record, "sessionId");
    const syscall = yield* parseSyscallRequest(record);
    return { deploymentId, projectId, sessionId, syscall };
  });
}

function parseInvokeFinishBodyResult(
  body: unknown,
): ExecutorHttpParseResult<FinishInvokeSessionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const sessionId = yield* requiredString(record, "sessionId");
    const value = yield* jsonValue(record.value, "value");
    return { deploymentId, projectId, sessionId, value };
  });
}

function parseInvokeAbortBodyResult(
  body: unknown,
): ExecutorHttpParseResult<AbortInvokeSessionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const sessionId = yield* requiredString(record, "sessionId");
    return { deploymentId, projectId, sessionId };
  });
}

function parseInvokeAbortStaleBodyResult(
  body: unknown,
): ExecutorHttpParseResult<AbortStaleInvokeSessionsInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const olderThan = yield* requiredDate(record, "olderThan");
    const maxSessions = yield* optionalPositiveInteger(record, "maxSessions");
    return {
      deploymentId,
      projectId,
      olderThan,
      ...(maxSessions === undefined ? {} : { limit: maxSessions }),
    };
  });
}

function parseInvokeSessionMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<RunInvokeSessionMaintenanceInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const staleAfterMs = yield* requiredPositiveInteger(record, "staleAfterMs");
    const maxSessions = yield* optionalPositiveInteger(record, "maxSessions");
    return {
      deploymentId,
      projectId,
      staleAfterMs,
      ...(maxSessions === undefined ? {} : { maxSessions }),
    };
  });
}

function parseLiveQueryRerunMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<LiveQueryRerunMaintenanceBody> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const limit = yield* optionalPositiveInteger(record, "limit");
    return {
      deploymentId,
      projectId,
      ...(limit === undefined ? {} : { limit }),
    };
  });
}

function parseLiveQueryDeliveryMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<LiveQueryDeliveryMaintenanceBody> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const limit = yield* optionalPositiveInteger(record, "limit");
    return {
      deploymentId,
      ...(limit === undefined ? {} : { limit }),
    };
  });
}

function parseLiveQuerySubscriptionRecordBodyResult(
  body: unknown,
): ExecutorHttpParseResult<RecordLiveQuerySubscriptionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const connectionId = yield* requiredString(record, "connectionId");
    const queryId = yield* requiredNonNegativeInteger(record, "queryId");
    const functionPath = yield* requiredString(record, "functionPath");
    const argsJson = yield* jsonValue(record.argsJson, "argsJson");
    const partitionKey = yield* optionalNullableString(
      record.partitionKey,
      "partitionKey",
    );
    const beginTs = yield* requiredNonNegativeInteger(record, "beginTs");
    const readSet = yield* requiredFreshnessReadSet(record.readSet, "readSet");
    const resultJson = yield* jsonValue(record.resultJson, "resultJson");
    const updatedAt = yield* optionalDate(record.updatedAt, "updatedAt");
    return {
      deploymentId,
      projectId,
      connectionId,
      queryId,
      functionPath,
      argsJson,
      ...(partitionKey === undefined
        ? {}
        : { partitionKey }),
      beginTs,
      readSet,
      resultJson,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    };
  });
}

function parseLiveQuerySubscriptionRemoveBodyResult(
  body: unknown,
): ExecutorHttpParseResult<RemoveLiveQuerySubscriptionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const connectionId = yield* requiredString(record, "connectionId");
    const queryId = yield* requiredNonNegativeInteger(record, "queryId");
    return { deploymentId, projectId, connectionId, queryId };
  });
}

function parseLiveQueryConnectionTouchBodyResult(
  body: unknown,
): ExecutorHttpParseResult<TouchLiveQueryConnectionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const connectionId = yield* requiredString(record, "connectionId");
    const leaseDurationMs = yield* optionalPositiveInteger(
      record,
      "leaseDurationMs",
    );
    return {
      deploymentId,
      projectId,
      connectionId,
      ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
    };
  });
}

function parseLiveQuerySubscriptionRemoveConnectionBodyResult(
  body: unknown,
): ExecutorHttpParseResult<RemoveLiveQuerySubscriptionsForConnectionInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const connectionId = yield* requiredString(record, "connectionId");
    return { deploymentId, projectId, connectionId };
  });
}

function parseLiveQueryConnectionCleanupBodyResult(
  body: unknown,
): ExecutorHttpParseResult<RemoveExpiredLiveQuerySubscriptionsInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const projectId = yield* requiredString(record, "projectId");
    const expiredAt = yield* optionalDate(record.expiredAt, "expiredAt");
    return {
      deploymentId,
      projectId,
      ...(expiredAt === undefined ? {} : { expiredAt }),
    };
  });
}

function parseLiveQueryClaimMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<ClaimLiveQueryDeliveryBatchInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const limit = yield* optionalPositiveInteger(record, "limit");
    const leaseDurationMs = yield* optionalPositiveInteger(
      record,
      "leaseDurationMs",
    );
    const claimOwner = yield* optionalString(record.claimOwner, "claimOwner");
    const cursor = yield* optionalLiveQueryDeliveryCursor(record.cursor);
    return {
      deploymentId,
      ...(limit === undefined ? {} : { limit }),
      ...(leaseDurationMs === undefined
        ? {}
        : { leaseDurationMs }),
      ...(claimOwner === undefined ? {} : { claimOwner }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function parseLiveQueryAckMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<AckLiveQueryDeliveriesInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const deliveryIds = yield* requiredStringArray(
      record.deliveryIds,
      "deliveryIds",
    );
    const deliveredAt = yield* optionalDate(record.deliveredAt, "deliveredAt");
    const claimOwner = yield* optionalString(record.claimOwner, "claimOwner");
    return {
      deploymentId,
      deliveryIds,
      ...(deliveredAt === undefined ? {} : { deliveredAt }),
      ...(claimOwner === undefined ? {} : { claimOwner }),
    };
  });
}

function parseLiveQueryFailureMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<RecordLiveQueryDeliveryFailureInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const deliveryIds = yield* requiredStringArray(
      record.deliveryIds,
      "deliveryIds",
    );
    const stage = yield* requiredLiveQueryDeliveryFailureStage(record.stage);
    const error = yield* requiredString(record, "error");
    const failedAt = yield* requiredDate(record, "failedAt");
    const claimOwner = yield* optionalString(record.claimOwner, "claimOwner");
    return {
      deploymentId,
      deliveryIds,
      stage,
      error,
      failedAt,
      ...(claimOwner === undefined ? {} : { claimOwner }),
    };
  });
}

function parseLiveQueryDeadLetterMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<MarkLiveQueryDeliveriesDeadLetteredInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* requiredString(record, "deploymentId");
    const deliveryIds = yield* requiredStringArray(
      record.deliveryIds,
      "deliveryIds",
    );
    const reason = yield* requiredString(record, "reason");
    const deadLetteredAt = yield* requiredDate(record, "deadLetteredAt");
    const claimOwner = yield* optionalString(record.claimOwner, "claimOwner");
    return {
      deploymentId,
      deliveryIds,
      reason,
      deadLetteredAt,
      ...(claimOwner === undefined ? {} : { claimOwner }),
    };
  });
}

function parseLiveQueryDeadLetterStuckMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<DeadLetterStuckLiveQueryDeliveriesInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* optionalString(
      record.deploymentId,
      "deploymentId",
    );
    const olderThan = yield* requiredDate(record, "olderThan");
    const minAttempts = yield* optionalPositiveInteger(record, "minAttempts");
    const limit = yield* optionalPositiveInteger(record, "limit");
    const reason = yield* requiredString(record, "reason");
    const deadLetteredAt = yield* optionalDate(
      record.deadLetteredAt,
      "deadLetteredAt",
    );
    const cursor = yield* optionalStuckLiveQueryDeliveryCursor(record.cursor);
    return {
      olderThan,
      reason,
      ...(deploymentId === undefined
        ? {}
        : { deploymentId }),
      ...(minAttempts === undefined
        ? {}
        : { minAttempts }),
      ...(limit === undefined ? {} : { limit }),
      ...(deadLetteredAt === undefined
        ? {}
        : { deadLetteredAt }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function parseLiveQueryPendingDeploymentsMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<ListPendingLiveQueryDeliveryDeploymentsInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const limit = yield* optionalPositiveInteger(record, "limit");
    const cursor = yield* optionalPendingLiveQueryDeliveryDeploymentCursor(
      record.cursor,
    );
    return {
      limit: limit ?? 100,
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function parseLiveQueryExpiredConnectionDeploymentsMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<ListExpiredLiveQueryConnectionDeploymentsInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const expiredAt = yield* optionalDate(record.expiredAt, "expiredAt");
    const limit = yield* optionalPositiveInteger(record, "limit");
    const cursor = yield* optionalExpiredLiveQueryConnectionDeploymentCursor(
      record.cursor,
    );
    return {
      ...(expiredAt === undefined ? {} : { expiredAt }),
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function parseLiveQueryStuckDeliveriesMaintenanceBodyResult(
  body: unknown,
): ExecutorHttpParseResult<ListStuckLiveQueryDeliveriesInput> {
  if (!isNonArrayRecord(body)) {
    return badRequest("Request body must be a JSON object.");
  }
  const record = body;
  return Result.gen(function* () {
    const deploymentId = yield* optionalString(
      record.deploymentId,
      "deploymentId",
    );
    const olderThan = yield* requiredDate(record, "olderThan");
    const minAttempts = yield* optionalPositiveInteger(record, "minAttempts");
    const limit = yield* optionalPositiveInteger(record, "limit");
    const cursor = yield* optionalStuckLiveQueryDeliveryCursor(record.cursor);
    return {
      olderThan,
      limit: limit ?? 100,
      ...(deploymentId === undefined
        ? {}
        : { deploymentId }),
      ...(minAttempts === undefined
        ? {}
        : { minAttempts }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function requiredLiveQueryDeliveryFailureStage(
  value: unknown,
): ExecutorHttpParseResult<"fanout" | "ack"> {
  return value === "fanout" || value === "ack"
    ? Result.succeed(value)
    : badRequest("stage must be fanout or ack.");
}

function optionalStuckLiveQueryDeliveryCursor(
  value: unknown,
): ExecutorHttpParseResult<
  { lastAttemptedAt: Date; deploymentId: string; deliveryId: string } | undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!isNonArrayRecord(value)) {
    return badRequest("cursor must be an object.");
  }
  const record = value;
  return Result.gen(function* () {
    const lastAttemptedAt = yield* optionalDate(
      record.lastAttemptedAt,
      "cursor.lastAttemptedAt",
    );
    const deploymentId = yield* prefixBadRequest(
      requiredString(record, "deploymentId"),
      "cursor.",
    );
    const deliveryId = yield* prefixBadRequest(
      requiredString(record, "deliveryId"),
      "cursor.",
    );
    if (lastAttemptedAt === undefined) {
      return yield* badRequest(
        "cursor.lastAttemptedAt must be an ISO timestamp string.",
      );
    }
    return { lastAttemptedAt, deploymentId, deliveryId };
  });
}

function parseSyscallRequest(
  record: UnknownRecord,
): ExecutorHttpParseResult<InvokeSyscallRequest> {
  if (record.op === "get") {
    return requiredString(record, "id").pipe(
      Result.map(id => ({ op: "get" as const, id })),
    );
  }
  if (record.op === "query") {
    return jsonValue(record.request, "request").pipe(
      Result.map(request => ({ op: "query" as const, request })),
    );
  }
  if (record.op === "insert") {
    return Result.gen(function* () {
      const table = yield* requiredString(record, "table");
      const value = yield* jsonValue(record.value, "value");
      const id = yield* optionalString(record.id, "id");
      return {
        op: "insert",
        table,
        value,
        ...(id === undefined ? {} : { id }),
      };
    });
  }
  if (record.op === "patch") {
    return Result.gen(function* () {
      const id = yield* requiredString(record, "id");
      const value = yield* jsonValue(record.value, "value");
      return { op: "patch" as const, id, value };
    });
  }
  if (record.op === "replace") {
    return Result.gen(function* () {
      const id = yield* requiredString(record, "id");
      const value = yield* jsonValue(record.value, "value");
      return { op: "replace" as const, id, value };
    });
  }
  if (record.op === "delete") {
    return requiredString(record, "id").pipe(
      Result.map(id => ({ op: "delete" as const, id })),
    );
  }
  return badRequest(
    "op must be get, query, insert, patch, replace, or delete.",
  );
}

function requiredString(
  record: UnknownRecord,
  field: string,
): ExecutorHttpParseResult<string> {
  const value = record[field];
  if (!isNonEmptyString(value)) {
    return badRequest(`${field} must be a non-empty string.`);
  }
  return Result.succeed(value);
}

function optionalInvokableKind(
  value: unknown,
): ExecutorHttpParseResult<InvokableFunctionKind | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (value === "query" || value === "mutation") return Result.succeed(value);
  return badRequest("kind must be query or mutation.");
}

function optionalFunctionVisibility(
  value: unknown,
): ExecutorHttpParseResult<FunctionVisibility | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (value === "public" || value === "internal") {
    return Result.succeed(value);
  }
  return badRequest("visibility must be public or internal.");
}

function optionalString(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<string | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (isNonEmptyString(value)) {
    return Result.succeed(value);
  }
  return badRequest(`${field} must be a non-empty string.`);
}

function optionalNullableString(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<string | null | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (value === null) return Result.succeed(null);
  if (isNonEmptyString(value)) {
    return Result.succeed(value);
  }
  return badRequest(`${field} must be a non-empty string or null.`);
}

function requiredDate(
  record: UnknownRecord,
  field: string,
): ExecutorHttpParseResult<Date> {
  const value = record[field];
  if (!isNonEmptyString(value)) {
    return badRequest(`${field} must be an ISO timestamp string.`);
  }
  const date = new Date(value);
  if (finiteDateMilliseconds(date) === undefined) {
    return badRequest(`${field} must be an ISO timestamp string.`);
  }
  return Result.succeed(date);
}

function optionalDate(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<Date | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (!isNonEmptyString(value)) {
    return badRequest(`${field} must be an ISO timestamp string.`);
  }
  const date = new Date(value);
  if (finiteDateMilliseconds(date) === undefined) {
    return badRequest(`${field} must be an ISO timestamp string.`);
  }
  return Result.succeed(date);
}

function requiredStringArray(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<string[]> {
  if (
    Array.isArray(value) &&
    value.every(isNonEmptyString)
  ) {
    return Result.succeed(value);
  }
  return badRequest(`${field} must be an array of non-empty strings.`);
}

function optionalLiveQueryDeliveryCursor(
  value: unknown,
): ExecutorHttpParseResult<
  { createdAt: Date; deliveryId: string } | undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!isNonArrayRecord(value)) {
    return badRequest("cursor must be an object.");
  }
  const record = value;
  return Result.gen(function* () {
    const createdAt = yield* optionalDate(
      record.createdAt,
      "cursor.createdAt",
    );
    const deliveryId = yield* prefixBadRequest(
      requiredString(record, "deliveryId"),
      "cursor.",
    );
    if (createdAt === undefined) {
      return yield* badRequest(
        "cursor.createdAt must be an ISO timestamp string.",
      );
    }
    return { createdAt, deliveryId };
  });
}

function optionalPendingLiveQueryDeliveryDeploymentCursor(
  value: unknown,
): ExecutorHttpParseResult<
  { oldestCreatedAt: Date; deploymentId: string } | undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!isNonArrayRecord(value)) {
    return badRequest("cursor must be an object.");
  }
  const record = value;
  return Result.gen(function* () {
    const oldestCreatedAt = yield* optionalDate(
      record.oldestCreatedAt,
      "cursor.oldestCreatedAt",
    );
    const deploymentId = yield* prefixBadRequest(
      requiredString(record, "deploymentId"),
      "cursor.",
    );
    if (oldestCreatedAt === undefined) {
      return yield* badRequest(
        "cursor.oldestCreatedAt must be an ISO timestamp string.",
      );
    }
    return { oldestCreatedAt, deploymentId };
  });
}

function optionalExpiredLiveQueryConnectionDeploymentCursor(
  value: unknown,
): ExecutorHttpParseResult<
  NonNullable<ListExpiredLiveQueryConnectionDeploymentsInput["cursor"]> |
    undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!isNonArrayRecord(value)) {
    return badRequest("cursor must be an object.");
  }
  const record = value;
  return Result.gen(function* () {
    const oldestExpiredAt = yield* optionalDate(
      record.oldestExpiredAt,
      "cursor.oldestExpiredAt",
    );
    const deploymentId = yield* prefixBadRequest(
      requiredString(record, "deploymentId"),
      "cursor.",
    );
    if (oldestExpiredAt === undefined) {
      return yield* badRequest(
        "cursor.oldestExpiredAt must be an ISO timestamp string.",
      );
    }
    return { oldestExpiredAt, deploymentId };
  });
}

function requiredPositiveInteger(
  record: UnknownRecord,
  field: string,
): ExecutorHttpParseResult<number> {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return badRequest(`${field} must be a positive integer.`);
  }
  return Result.succeed(value);
}

function requiredNonNegativeInteger(
  record: UnknownRecord,
  field: string,
): ExecutorHttpParseResult<number> {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return badRequest(`${field} must be a non-negative integer.`);
  }
  return Result.succeed(value);
}

function optionalPositiveInteger(
  record: UnknownRecord,
  field: string,
): ExecutorHttpParseResult<number | undefined> {
  if (record[field] === undefined) return Result.succeed(undefined);
  return requiredPositiveInteger(record, field);
}

function jsonValue(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<Json> {
  if (!isJson(value)) {
    return badRequest(`${field} must be a JSON value.`);
  }
  return Result.succeed(value);
}

function requiredJsonObject(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<JsonObject> {
  return jsonValue(value, field).pipe(
    Result.flatMap(parsed =>
      isJsonObject(parsed)
        ? Result.succeed(parsed)
        : badRequest(`${field} must be a JSON object.`)
    ),
  );
}

function requiredFreshnessReadSet(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<RecordLiveQuerySubscriptionInput["readSet"]> {
  return Result.gen(function* () {
    const parsed = yield* requiredJsonObject(value, field);
    const documents = yield* optionalDocumentReadSet(
      parsed.documents,
      `${field}.documents`,
    );
    const tables = yield* optionalTableReadSet(
      parsed.tables,
      `${field}.tables`,
    );
    const indexes = yield* optionalIndexReadSet(
      parsed.indexes,
      `${field}.indexes`,
    );
    return {
      ...(documents === undefined ? {} : { documents }),
      ...(tables === undefined ? {} : { tables }),
      ...(indexes === undefined ? {} : { indexes }),
    };
  });
}

function optionalDocumentReadSet(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<
  NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["documents"]> |
    undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  return Result.gen(function* () {
    const documents: NonNullable<
      RecordLiveQuerySubscriptionInput["readSet"]["documents"]
    > = [];
    for (const [index, item] of value.entries()) {
      const itemPath = `${field}[${index}]`;
      const record = yield* itemRecord(item, itemPath);
      const tableId = yield* prefixBadRequest(
        requiredNonNegativeInteger(record, "tableId"),
        `${itemPath}.`,
      );
      const id = yield* prefixBadRequest(
        requiredString(record, "id"),
        `${itemPath}.`,
      );
      const observedTs = yield* optionalObservedTs(
        record.observedTs,
        `${itemPath}.observedTs`,
      );
      documents.push({
        tableId,
        id,
        ...(observedTs === undefined ? {} : { observedTs }),
      });
    }
    return documents;
  });
}

function optionalTableReadSet(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<
  NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["tables"]> |
    undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  return Result.gen(function* () {
    const tables: NonNullable<
      RecordLiveQuerySubscriptionInput["readSet"]["tables"]
    > = [];
    for (const [index, item] of value.entries()) {
      const itemPath = `${field}[${index}]`;
      const record = yield* itemRecord(item, itemPath);
      const tableId = yield* prefixBadRequest(
        requiredNonNegativeInteger(record, "tableId"),
        `${itemPath}.`,
      );
      const observedTs = yield* optionalNonNegativeInteger(
        record.observedTs,
        `${itemPath}.observedTs`,
      );
      tables.push({
        tableId,
        ...(observedTs === undefined ? {} : { observedTs }),
      });
    }
    return tables;
  });
}

function optionalIndexReadSet(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<
  NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["indexes"]> |
    undefined
> {
  if (value === undefined) return Result.succeed(undefined);
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  return Result.gen(function* () {
    const indexes: NonNullable<
      RecordLiveQuerySubscriptionInput["readSet"]["indexes"]
    > = [];
    for (const [index, item] of value.entries()) {
      const itemPath = `${field}[${index}]`;
      const record = yield* itemRecord(item, itemPath);
      const indexId = yield* prefixBadRequest(
        requiredNonNegativeInteger(record, "indexId"),
        `${itemPath}.`,
      );
      const observedTs = yield* optionalNonNegativeInteger(
        record.observedTs,
        `${itemPath}.observedTs`,
      );
      const lower = yield* optionalString(record.lower, `${itemPath}.lower`);
      const upper = yield* optionalString(record.upper, `${itemPath}.upper`);
      indexes.push({
        indexId,
        ...(observedTs === undefined ? {} : { observedTs }),
        ...(lower === undefined ? {} : { lower }),
        ...(upper === undefined ? {} : { upper }),
      });
    }
    return indexes;
  });
}

function itemRecord(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<UnknownRecord> {
  if (isNonArrayRecord(value)) {
    return Result.succeed(value);
  }
  return badRequest(`${field} must be an object.`);
}

function optionalObservedTs(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<number | null | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (value === null) return Result.succeed(null);
  return optionalNonNegativeInteger(value, field);
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string,
): ExecutorHttpParseResult<number | undefined> {
  if (value === undefined) return Result.succeed(undefined);
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return badRequest(`${field} must be a non-negative integer.`);
  }
  return Result.succeed(value);
}

function badRequest<A = never>(message: string): ExecutorHttpParseResult<A> {
  return Result.fail({ error: "bad_request", message });
}

function prefixBadRequest<A>(
  result: ExecutorHttpParseResult<A>,
  prefix: string,
): ExecutorHttpParseResult<A> {
  return result.pipe(
    Result.mapError(body => ({
      ...body,
      message: `${prefix}${body.message}`,
    })),
  );
}

function isJson(value: unknown): value is Json {
  return isProtocolJson(value);
}
