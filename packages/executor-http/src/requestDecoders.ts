import { Effect } from "effect";
import { decodeExecutionIdentityEffect } from "flarex-protocol/auth";
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
  RerunStaleLiveQuerySubscriptionsInput,
  RunLiveQueryDeliveryBatchInput,
  TouchLiveQueryConnectionInput,
} from "@flarex/executor";
import {
  type BadRequestBody,
  ExecutorHttpBodyValidationError,
  ExecutorHttpJsonBodyError,
} from "./errors";

type ExecutorHttpParseResult<A> =
  | { value: A }
  | { error: BadRequestBody };

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
  return "error" in result
    ? Effect.fail(new ExecutorHttpBodyValidationError({ body: result.error }))
    : Effect.succeed(result.value);
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
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return parsed;
    }
    const record = body as Record<string, unknown>;
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
  return decodeExecutorHttpValidationResult(parseLiveQuerySubscriptionRecordBodyResult(body));
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
):
  | { value: PrepareInvokeInput }
  | { error: { error: "bad_request"; message: string } } {
  return parseInvokeBodyResult(body, { includeIdempotencyKey: false });
}

function parseBeginInvokeSessionBodyResult(
  body: unknown,
):
  | { value: BeginInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } } {
  return parseInvokeBodyResult(body, { includeIdempotencyKey: true });
}

function parseInvokeBodyResult(
  body: unknown,
  options: { includeIdempotencyKey: false },
):
  | { value: PrepareInvokeInput }
  | { error: { error: "bad_request"; message: string } };
function parseInvokeBodyResult(
  body: unknown,
  options: { includeIdempotencyKey: true },
):
  | { value: BeginInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } };
function parseInvokeBodyResult(
  body: unknown,
  options: { includeIdempotencyKey: boolean },
):
  | {
      value: BeginInvokeSessionInput;
    }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const path = requiredString(record, "path");
  if ("error" in path) return path;
  const kind = optionalInvokableKind(record.kind);
  if ("error" in kind) return kind;
  const visibility = optionalFunctionVisibility(record.visibility);
  if ("error" in visibility) return visibility;
  const args = jsonValue(record.args, "args");
  if ("error" in args) return args;
  const partitionKey = optionalString(record.partitionKey, "partitionKey");
  if ("error" in partitionKey) return partitionKey;
  const idempotencyKey = optionalString(record.idempotencyKey, "idempotencyKey");
  if ("error" in idempotencyKey) return idempotencyKey;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      path: path.value,
      ...(kind.value === undefined ? {} : { kind: kind.value }),
      ...(visibility.value === undefined ? {} : { visibility: visibility.value }),
      args: args.value,
      ...(partitionKey.value === undefined
        ? {}
        : { partitionKey: partitionKey.value }),
      ...(options.includeIdempotencyKey && idempotencyKey.value !== undefined
        ? { idempotencyKey: idempotencyKey.value }
        : {}),
    },
  };
}

function parseInvokeSyscallBodyResult(
  body: unknown,
):
  | { value: InvokeSyscallInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const sessionId = requiredString(record, "sessionId");
  if ("error" in sessionId) return sessionId;
  const syscall = parseSyscallRequest(record);
  if ("error" in syscall) return syscall;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      sessionId: sessionId.value,
      syscall: syscall.value,
    },
  };
}

function parseInvokeFinishBodyResult(
  body: unknown,
):
  | { value: FinishInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const sessionId = requiredString(record, "sessionId");
  if ("error" in sessionId) return sessionId;
  const value = jsonValue(record.value, "value");
  if ("error" in value) return value;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      sessionId: sessionId.value,
      value: value.value,
    },
  };
}

function parseInvokeAbortBodyResult(
  body: unknown,
):
  | { value: AbortInvokeSessionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const sessionId = requiredString(record, "sessionId");
  if ("error" in sessionId) return sessionId;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      sessionId: sessionId.value,
    },
  };
}

function parseInvokeAbortStaleBodyResult(
  body: unknown,
):
  | { value: AbortStaleInvokeSessionsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const olderThan = requiredDate(record, "olderThan");
  if ("error" in olderThan) return olderThan;
  const maxSessions = optionalPositiveInteger(record, "maxSessions");
  if ("error" in maxSessions) return maxSessions;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      olderThan: olderThan.value,
      ...(maxSessions.value === undefined
        ? {}
        : { limit: maxSessions.value }),
    },
  };
}

function parseInvokeSessionMaintenanceBodyResult(
  body: unknown,
):
  | { value: RunInvokeSessionMaintenanceInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const staleAfterMs = requiredPositiveInteger(record, "staleAfterMs");
  if ("error" in staleAfterMs) return staleAfterMs;
  const maxSessions = optionalPositiveInteger(record, "maxSessions");
  if ("error" in maxSessions) return maxSessions;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      staleAfterMs: staleAfterMs.value,
      ...(maxSessions.value === undefined
        ? {}
        : { maxSessions: maxSessions.value }),
    },
  };
}

function parseLiveQueryRerunMaintenanceBodyResult(
  body: unknown,
):
  | { value: { deploymentId: string; projectId: string; limit?: number } }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function parseLiveQueryDeliveryMaintenanceBodyResult(
  body: unknown,
):
  | { value: { deploymentId: string; limit?: number } }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;

  return {
    value: {
      deploymentId: deploymentId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
    },
  };
}

function parseLiveQuerySubscriptionRecordBodyResult(
  body: unknown,
):
  | { value: RecordLiveQuerySubscriptionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;
  const queryId = requiredNonNegativeInteger(record, "queryId");
  if ("error" in queryId) return queryId;
  const functionPath = requiredString(record, "functionPath");
  if ("error" in functionPath) return functionPath;
  const argsJson = jsonValue(record.argsJson, "argsJson");
  if ("error" in argsJson) return argsJson;
  const partitionKey = optionalNullableString(record.partitionKey, "partitionKey");
  if ("error" in partitionKey) return partitionKey;
  const beginTs = requiredNonNegativeInteger(record, "beginTs");
  if ("error" in beginTs) return beginTs;
  const readSet = requiredFreshnessReadSet(record.readSet, "readSet");
  if ("error" in readSet) return readSet;
  const resultJson = jsonValue(record.resultJson, "resultJson");
  if ("error" in resultJson) return resultJson;
  const updatedAt = optionalDate(record.updatedAt, "updatedAt");
  if ("error" in updatedAt) return updatedAt;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
      queryId: queryId.value,
      functionPath: functionPath.value,
      argsJson: argsJson.value,
      ...(partitionKey.value === undefined
        ? {}
        : { partitionKey: partitionKey.value }),
      beginTs: beginTs.value,
      readSet: readSet.value,
      resultJson: resultJson.value,
      ...(updatedAt.value === undefined ? {} : { updatedAt: updatedAt.value }),
    },
  };
}

function parseLiveQuerySubscriptionRemoveBodyResult(
  body: unknown,
):
  | { value: RemoveLiveQuerySubscriptionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;
  const queryId = requiredNonNegativeInteger(record, "queryId");
  if ("error" in queryId) return queryId;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
      queryId: queryId.value,
    },
  };
}

function parseLiveQueryConnectionTouchBodyResult(
  body: unknown,
):
  | { value: TouchLiveQueryConnectionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;
  const leaseDurationMs = optionalPositiveInteger(record, "leaseDurationMs");
  if ("error" in leaseDurationMs) return leaseDurationMs;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
      ...(leaseDurationMs.value === undefined
        ? {}
        : { leaseDurationMs: leaseDurationMs.value }),
    },
  };
}

function parseLiveQuerySubscriptionRemoveConnectionBodyResult(
  body: unknown,
):
  | { value: RemoveLiveQuerySubscriptionsForConnectionInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const connectionId = requiredString(record, "connectionId");
  if ("error" in connectionId) return connectionId;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      connectionId: connectionId.value,
    },
  };
}

function parseLiveQueryConnectionCleanupBodyResult(
  body: unknown,
):
  | { value: RemoveExpiredLiveQuerySubscriptionsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const projectId = requiredString(record, "projectId");
  if ("error" in projectId) return projectId;
  const expiredAt = optionalDate(record.expiredAt, "expiredAt");
  if ("error" in expiredAt) return expiredAt;

  return {
    value: {
      deploymentId: deploymentId.value,
      projectId: projectId.value,
      ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
    },
  };
}

function parseLiveQueryClaimMaintenanceBodyResult(
  body: unknown,
):
  | { value: ClaimLiveQueryDeliveryBatchInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const leaseDurationMs = optionalPositiveInteger(record, "leaseDurationMs");
  if ("error" in leaseDurationMs) return leaseDurationMs;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;
  const cursor = optionalLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      deploymentId: deploymentId.value,
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(leaseDurationMs.value === undefined
        ? {}
        : { leaseDurationMs: leaseDurationMs.value }),
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryAckMaintenanceBodyResult(
  body: unknown,
):
  | { value: AckLiveQueryDeliveriesInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const deliveryIds = requiredStringArray(record.deliveryIds, "deliveryIds");
  if ("error" in deliveryIds) return deliveryIds;
  const deliveredAt = optionalDate(record.deliveredAt, "deliveredAt");
  if ("error" in deliveredAt) return deliveredAt;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      ...(deliveredAt.value === undefined ? {} : { deliveredAt: deliveredAt.value }),
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
    },
  };
}

function parseLiveQueryFailureMaintenanceBodyResult(
  body: unknown,
):
  | { value: RecordLiveQueryDeliveryFailureInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const deliveryIds = requiredStringArray(record.deliveryIds, "deliveryIds");
  if ("error" in deliveryIds) return deliveryIds;
  const stage = requiredLiveQueryDeliveryFailureStage(record.stage);
  if ("error" in stage) return stage;
  const error = requiredString(record, "error");
  if ("error" in error) return error;
  const failedAt = requiredDate(record, "failedAt");
  if ("error" in failedAt) return failedAt;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      stage: stage.value,
      error: error.value,
      failedAt: failedAt.value,
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
    },
  };
}

function parseLiveQueryDeadLetterMaintenanceBodyResult(
  body: unknown,
):
  | { value: MarkLiveQueryDeliveriesDeadLetteredInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const deliveryIds = requiredStringArray(record.deliveryIds, "deliveryIds");
  if ("error" in deliveryIds) return deliveryIds;
  const reason = requiredString(record, "reason");
  if ("error" in reason) return reason;
  const deadLetteredAt = requiredDate(record, "deadLetteredAt");
  if ("error" in deadLetteredAt) return deadLetteredAt;
  const claimOwner = optionalString(record.claimOwner, "claimOwner");
  if ("error" in claimOwner) return claimOwner;

  return {
    value: {
      deploymentId: deploymentId.value,
      deliveryIds: deliveryIds.value,
      reason: reason.value,
      deadLetteredAt: deadLetteredAt.value,
      ...(claimOwner.value === undefined ? {} : { claimOwner: claimOwner.value }),
    },
  };
}

function parseLiveQueryDeadLetterStuckMaintenanceBodyResult(
  body: unknown,
):
  | { value: DeadLetterStuckLiveQueryDeliveriesInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = optionalString(record.deploymentId, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const olderThan = requiredDate(record, "olderThan");
  if ("error" in olderThan) return olderThan;
  const minAttempts = optionalPositiveInteger(record, "minAttempts");
  if ("error" in minAttempts) return minAttempts;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const reason = requiredString(record, "reason");
  if ("error" in reason) return reason;
  const deadLetteredAt = optionalDate(record.deadLetteredAt, "deadLetteredAt");
  if ("error" in deadLetteredAt) return deadLetteredAt;
  const cursor = optionalStuckLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      olderThan: olderThan.value,
      reason: reason.value,
      ...(deploymentId.value === undefined
        ? {}
        : { deploymentId: deploymentId.value }),
      ...(minAttempts.value === undefined
        ? {}
        : { minAttempts: minAttempts.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(deadLetteredAt.value === undefined
        ? {}
        : { deadLetteredAt: deadLetteredAt.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryPendingDeploymentsMaintenanceBodyResult(
  body: unknown,
):
  | { value: ListPendingLiveQueryDeliveryDeploymentsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const cursor = optionalPendingLiveQueryDeliveryDeploymentCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      limit: limit.value ?? 100,
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryExpiredConnectionDeploymentsMaintenanceBodyResult(
  body: unknown,
):
  | { value: ListExpiredLiveQueryConnectionDeploymentsInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const expiredAt = optionalDate(record.expiredAt, "expiredAt");
  if ("error" in expiredAt) return expiredAt;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const cursor = optionalExpiredLiveQueryConnectionDeploymentCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function parseLiveQueryStuckDeliveriesMaintenanceBodyResult(
  body: unknown,
):
  | { value: ListStuckLiveQueryDeliveriesInput }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      error: {
        error: "bad_request",
        message: "Request body must be a JSON object.",
      },
    };
  }
  const record = body as Record<string, unknown>;
  const deploymentId = optionalString(record.deploymentId, "deploymentId");
  if ("error" in deploymentId) return deploymentId;
  const olderThan = requiredDate(record, "olderThan");
  if ("error" in olderThan) return olderThan;
  const minAttempts = optionalPositiveInteger(record, "minAttempts");
  if ("error" in minAttempts) return minAttempts;
  const limit = optionalPositiveInteger(record, "limit");
  if ("error" in limit) return limit;
  const cursor = optionalStuckLiveQueryDeliveryCursor(record.cursor);
  if ("error" in cursor) return cursor;

  return {
    value: {
      olderThan: olderThan.value,
      limit: limit.value ?? 100,
      ...(deploymentId.value === undefined
        ? {}
        : { deploymentId: deploymentId.value }),
      ...(minAttempts.value === undefined
        ? {}
        : { minAttempts: minAttempts.value }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
    },
  };
}

function requiredLiveQueryDeliveryFailureStage(
  value: unknown,
):
  | { value: "fanout" | "ack" }
  | { error: { error: "bad_request"; message: string } } {
  if (value === "fanout" || value === "ack") return { value };
  return {
    error: {
      error: "bad_request",
      message: "stage must be fanout or ack.",
    },
  };
}

function optionalStuckLiveQueryDeliveryCursor(
  value: unknown,
):
  | { value?: { lastAttemptedAt: Date; deploymentId: string; deliveryId: string } }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const lastAttemptedAt = optionalDate(
    record.lastAttemptedAt,
    "cursor.lastAttemptedAt",
  );
  if ("error" in lastAttemptedAt) return lastAttemptedAt;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deploymentId must be a non-empty string.",
      },
    };
  }
  const deliveryId = requiredString(record, "deliveryId");
  if ("error" in deliveryId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deliveryId must be a non-empty string.",
      },
    };
  }
  if (lastAttemptedAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.lastAttemptedAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      lastAttemptedAt: lastAttemptedAt.value,
      deploymentId: deploymentId.value,
      deliveryId: deliveryId.value,
    },
  };
}

function parseSyscallRequest(
  record: Record<string, unknown>,
):
  | { value: InvokeSyscallRequest }
  | { error: { error: "bad_request"; message: string } } {
  if (record.op === "get") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    return { value: { op: "get", id: id.value } };
  }
  if (record.op === "query") {
    const request = jsonValue(record.request, "request");
    if ("error" in request) return request;
    return { value: { op: "query", request: request.value } };
  }
  if (record.op === "insert") {
    const table = requiredString(record, "table");
    if ("error" in table) return table;
    const value = jsonValue(record.value, "value");
    if ("error" in value) return value;
    const id = optionalString(record.id, "id");
    if ("error" in id) return id;
    return {
      value: {
        op: "insert",
        table: table.value,
        value: value.value,
        ...(id.value === undefined ? {} : { id: id.value }),
      },
    };
  }
  if (record.op === "patch") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    const value = jsonValue(record.value, "value");
    if ("error" in value) return value;
    return { value: { op: "patch", id: id.value, value: value.value } };
  }
  if (record.op === "replace") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    const value = jsonValue(record.value, "value");
    if ("error" in value) return value;
    return { value: { op: "replace", id: id.value, value: value.value } };
  }
  if (record.op === "delete") {
    const id = requiredString(record, "id");
    if ("error" in id) return id;
    return { value: { op: "delete", id: id.value } };
  }
  return {
    error: {
      error: "bad_request",
      message: "op must be get, query, insert, patch, replace, or delete.",
    },
  };
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): { value: string } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a non-empty string.`,
      },
    };
  }
  return { value };
}

function optionalInvokableKind(
  value: unknown,
):
  | { value?: InvokableFunctionKind }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === "query" || value === "mutation") return { value };
  return {
    error: {
      error: "bad_request",
      message: "kind must be query or mutation.",
    },
  };
}

function optionalFunctionVisibility(
  value: unknown,
):
  | { value?: FunctionVisibility }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === "public" || value === "internal") return { value };
  return {
    error: {
      error: "bad_request",
      message: "visibility must be public or internal.",
    },
  };
}

function optionalString(
  value: unknown,
  field: string,
): { value?: string } | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value === "string" && value.length > 0) return { value };
  return {
    error: {
      error: "bad_request",
      message: `${field} must be a non-empty string.`,
    },
  };
}

function optionalNullableString(
  value: unknown,
  field: string,
):
  | { value?: string | null }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  if (typeof value === "string" && value.length > 0) return { value };
  return {
    error: {
      error: "bad_request",
      message: `${field} must be a non-empty string or null.`,
    },
  };
}

function requiredDate(
  record: Record<string, unknown>,
  field: string,
): { value: Date } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  return { value: date };
}

function optionalDate(
  value: unknown,
  field: string,
): { value?: Date } | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.length === 0) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be an ISO timestamp string.`,
      },
    };
  }
  return { value: date };
}

function requiredStringArray(
  value: unknown,
  field: string,
): { value: string[] } | { error: { error: "bad_request"; message: string } } {
  if (
    Array.isArray(value) &&
    value.every(item => typeof item === "string" && item.length > 0)
  ) {
    return { value };
  }
  return {
    error: {
      error: "bad_request",
      message: `${field} must be an array of non-empty strings.`,
    },
  };
}

function optionalLiveQueryDeliveryCursor(
  value: unknown,
):
  | { value?: { createdAt: Date; deliveryId: string } }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const createdAt = optionalDate(record.createdAt, "cursor.createdAt");
  if ("error" in createdAt) return createdAt;
  const deliveryId = requiredString(record, "deliveryId");
  if ("error" in deliveryId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deliveryId must be a non-empty string.",
      },
    };
  }
  if (createdAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.createdAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      createdAt: createdAt.value,
      deliveryId: deliveryId.value,
    },
  };
}

function optionalPendingLiveQueryDeliveryDeploymentCursor(
  value: unknown,
):
  | { value?: { oldestCreatedAt: Date; deploymentId: string } }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const oldestCreatedAt = optionalDate(
    record.oldestCreatedAt,
    "cursor.oldestCreatedAt",
  );
  if ("error" in oldestCreatedAt) return oldestCreatedAt;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deploymentId must be a non-empty string.",
      },
    };
  }
  if (oldestCreatedAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.oldestCreatedAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      oldestCreatedAt: oldestCreatedAt.value,
      deploymentId: deploymentId.value,
    },
  };
}

function optionalExpiredLiveQueryConnectionDeploymentCursor(
  value: unknown,
):
  | { value?: NonNullable<ListExpiredLiveQueryConnectionDeploymentsInput["cursor"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      error: {
        error: "bad_request",
        message: "cursor must be an object.",
      },
    };
  }
  const record = value as Record<string, unknown>;
  const oldestExpiredAt = optionalDate(
    record.oldestExpiredAt,
    "cursor.oldestExpiredAt",
  );
  if ("error" in oldestExpiredAt) return oldestExpiredAt;
  const deploymentId = requiredString(record, "deploymentId");
  if ("error" in deploymentId) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.deploymentId must be a non-empty string.",
      },
    };
  }
  if (oldestExpiredAt.value === undefined) {
    return {
      error: {
        error: "bad_request",
        message: "cursor.oldestExpiredAt must be an ISO timestamp string.",
      },
    };
  }
  return {
    value: {
      oldestExpiredAt: oldestExpiredAt.value,
      deploymentId: deploymentId.value,
    },
  };
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  field: string,
): { value: number } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a positive integer.`,
      },
    };
  }
  return { value };
}

function requiredNonNegativeInteger(
  record: Record<string, unknown>,
  field: string,
): { value: number } | { error: { error: "bad_request"; message: string } } {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a non-negative integer.`,
      },
    };
  }
  return { value };
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  field: string,
):
  | { value?: number }
  | { error: { error: "bad_request"; message: string } } {
  if (record[field] === undefined) return {};
  return requiredPositiveInteger(record, field);
}

function jsonValue(
  value: unknown,
  field: string,
): { value: Json } | { error: { error: "bad_request"; message: string } } {
  if (!isJson(value)) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a JSON value.`,
      },
    };
  }
  return { value };
}

function requiredJsonObject(
  value: unknown,
  field: string,
):
  | { value: Record<string, Json> }
  | { error: { error: "bad_request"; message: string } } {
  const parsed = jsonValue(value, field);
  if ("error" in parsed) return parsed;
  if (
    parsed.value === null ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value)
  ) {
    return {
      error: {
        error: "bad_request",
        message: `${field} must be a JSON object.`,
      },
    };
  }
  return { value: parsed.value };
}

function requiredFreshnessReadSet(
  value: unknown,
  field: string,
):
  | { value: RecordLiveQuerySubscriptionInput["readSet"] }
  | { error: { error: "bad_request"; message: string } } {
  const parsed = requiredJsonObject(value, field);
  if ("error" in parsed) return parsed;
  const documents = optionalDocumentReadSet(parsed.value.documents, `${field}.documents`);
  if ("error" in documents) return documents;
  const tables = optionalTableReadSet(parsed.value.tables, `${field}.tables`);
  if ("error" in tables) return tables;
  const indexes = optionalIndexReadSet(parsed.value.indexes, `${field}.indexes`);
  if ("error" in indexes) return indexes;
  return {
    value: {
      ...(documents.value === undefined ? {} : { documents: documents.value }),
      ...(tables.value === undefined ? {} : { tables: tables.value }),
      ...(indexes.value === undefined ? {} : { indexes: indexes.value }),
    },
  };
}

function optionalDocumentReadSet(
  value: unknown,
  field: string,
):
  | { value?: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["documents"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  const documents: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["documents"]> = [];
  for (const [index, item] of value.entries()) {
    const record = itemRecord(item, `${field}[${index}]`);
    if ("error" in record) return record;
    const tableId = requiredNonNegativeInteger(record.value, "tableId");
    if ("error" in tableId) return prefixBadRequest(tableId, `${field}[${index}].`);
    const id = requiredString(record.value, "id");
    if ("error" in id) return prefixBadRequest(id, `${field}[${index}].`);
    const observedTs = optionalObservedTs(record.value.observedTs, `${field}[${index}].observedTs`);
    if ("error" in observedTs) return observedTs;
    documents.push({
      tableId: tableId.value,
      id: id.value,
      ...(observedTs.value === undefined ? {} : { observedTs: observedTs.value }),
    });
  }
  return { value: documents };
}

function optionalTableReadSet(
  value: unknown,
  field: string,
):
  | { value?: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["tables"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  const tables: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["tables"]> = [];
  for (const [index, item] of value.entries()) {
    const record = itemRecord(item, `${field}[${index}]`);
    if ("error" in record) return record;
    const tableId = requiredNonNegativeInteger(record.value, "tableId");
    if ("error" in tableId) return prefixBadRequest(tableId, `${field}[${index}].`);
    const observedTs = optionalNonNegativeInteger(
      record.value.observedTs,
      `${field}[${index}].observedTs`,
    );
    if ("error" in observedTs) return observedTs;
    tables.push({
      tableId: tableId.value,
      ...(observedTs.value === undefined ? {} : { observedTs: observedTs.value }),
    });
  }
  return { value: tables };
}

function optionalIndexReadSet(
  value: unknown,
  field: string,
):
  | { value?: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["indexes"]> }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return badRequest(`${field} must be an array.`);
  const indexes: NonNullable<RecordLiveQuerySubscriptionInput["readSet"]["indexes"]> = [];
  for (const [index, item] of value.entries()) {
    const record = itemRecord(item, `${field}[${index}]`);
    if ("error" in record) return record;
    const indexId = requiredNonNegativeInteger(record.value, "indexId");
    if ("error" in indexId) return prefixBadRequest(indexId, `${field}[${index}].`);
    const observedTs = optionalNonNegativeInteger(
      record.value.observedTs,
      `${field}[${index}].observedTs`,
    );
    if ("error" in observedTs) return observedTs;
    const lower = optionalString(record.value.lower, `${field}[${index}].lower`);
    if ("error" in lower) return lower;
    const upper = optionalString(record.value.upper, `${field}[${index}].upper`);
    if ("error" in upper) return upper;
    indexes.push({
      indexId: indexId.value,
      ...(observedTs.value === undefined ? {} : { observedTs: observedTs.value }),
      ...(lower.value === undefined ? {} : { lower: lower.value }),
      ...(upper.value === undefined ? {} : { upper: upper.value }),
    });
  }
  return { value: indexes };
}

function itemRecord(
  value: unknown,
  field: string,
):
  | { value: Record<string, unknown> }
  | { error: { error: "bad_request"; message: string } } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { value: value as Record<string, unknown> };
  }
  return badRequest(`${field} must be an object.`);
}

function optionalObservedTs(
  value: unknown,
  field: string,
):
  | { value?: number | null }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  return optionalNonNegativeInteger(value, field);
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string,
):
  | { value?: number }
  | { error: { error: "bad_request"; message: string } } {
  if (value === undefined) return {};
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return badRequest(`${field} must be a non-negative integer.`);
  }
  return { value };
}

function badRequest(message: string): { error: { error: "bad_request"; message: string } } {
  return { error: { error: "bad_request", message } };
}

function prefixBadRequest(
  result: { error: { error: "bad_request"; message: string } },
  prefix: string,
): { error: { error: "bad_request"; message: string } } {
  return badRequest(`${prefix}${result.error.message}`);
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Number.isFinite(value as number) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every(isJson);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJson);
  }
  return false;
}
