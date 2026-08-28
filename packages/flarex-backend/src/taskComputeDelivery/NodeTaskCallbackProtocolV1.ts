import type { TaskComputeExecutionIdV1 } from
  "@flarex/durable-task/internal/compute-provider-v1";
import { TaskComputeExecutionIdV1Schema } from
  "@flarex/durable-task/internal/compute-provider-v1";
import { copyBytes, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result, Schema } from "effect";
import {
  decodeApplicationTaskMutationCallbackRequestV1,
  decodeApplicationTaskMutationCallbackResultV1,
  type ApplicationTaskMutationCallbackRequestV1,
  type ApplicationTaskMutationCallbackResultV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import {
  decodeApplicationTaskQueryCallbackRequestV1,
  decodeApplicationTaskQueryCallbackResultV1,
  type ApplicationTaskQueryCallbackRequestV1,
  type ApplicationTaskQueryCallbackResultV1,
} from "flarex-protocol/internal/application-task-query-callback-v1";

import type {
  NodeTaskExecutorSessionIdV1,
  NodeTaskExecutorStartKeyV1,
} from "./NodeTaskExecutorProtocolV1.js";

export const NODE_TASK_CALLBACK_REQUEST_FORMAT_V1 =
  "flarex.node-task-callback/request" as const;
export const NODE_TASK_CALLBACK_RESPONSE_FORMAT_V1 =
  "flarex.node-task-callback/response" as const;
export const NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1 =
  "flarex.node-task-callback/attachment" as const;
export const NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1 =
  "flarex.node-task-callback/attachment-ack" as const;
export const NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1 = 1 as const;
export const NODE_TASK_CALLBACK_CREDENTIAL_BYTES_V1 = 32 as const;

export type NodeTaskCallbackCredentialV1 = Uint8Array & {
  readonly NodeTaskCallbackCredentialV1: unique symbol;
};

export type NodeTaskCallbackRequestIdV1 = string & {
  readonly NodeTaskCallbackRequestIdV1: unique symbol;
};

export type NodeTaskCallbackSequenceV1 = bigint & {
  readonly NodeTaskCallbackSequenceV1: unique symbol;
};

export interface NodeTaskCallbackAttachmentV1 {
  readonly format: typeof NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1;
  readonly version: typeof NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1;
  readonly capabilityId: string;
  readonly credential: NodeTaskCallbackCredentialV1;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly expiresAtEpochMilliseconds: number;
}

export interface NodeTaskCallbackAttachmentAckV1 {
  readonly format: typeof NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1;
  readonly version: typeof NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1;
  readonly kind: "attached";
  readonly capabilityId: string;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly expiresAtEpochMilliseconds: number;
}

interface NodeTaskCallbackRequestCommonV1 {
  readonly format: typeof NODE_TASK_CALLBACK_REQUEST_FORMAT_V1;
  readonly version: typeof NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1;
  readonly capabilityId: string;
  readonly credential: NodeTaskCallbackCredentialV1;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly sequence: NodeTaskCallbackSequenceV1;
  readonly requestId: NodeTaskCallbackRequestIdV1;
}

export type NodeTaskCallbackRequestV1 =
  | (NodeTaskCallbackRequestCommonV1 & Readonly<{
      readonly operation: "runQuery";
      readonly payload: ApplicationTaskQueryCallbackRequestV1;
    }>)
  | (NodeTaskCallbackRequestCommonV1 & Readonly<{
      readonly operation: "runMutation";
      readonly payload: ApplicationTaskMutationCallbackRequestV1;
    }>);

interface NodeTaskCallbackResponseCommonV1 {
  readonly format: typeof NODE_TASK_CALLBACK_RESPONSE_FORMAT_V1;
  readonly version: typeof NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1;
  readonly capabilityId: string;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly sessionId: NodeTaskExecutorSessionIdV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly sequence: NodeTaskCallbackSequenceV1;
  readonly requestId: NodeTaskCallbackRequestIdV1;
}

export type NodeTaskCallbackResponseV1 =
  | (NodeTaskCallbackResponseCommonV1 & Readonly<{
      readonly operation: "runQuery";
      readonly result: ApplicationTaskQueryCallbackResultV1;
    }>)
  | (NodeTaskCallbackResponseCommonV1 & Readonly<{
      readonly operation: "runMutation";
      readonly result: ApplicationTaskMutationCallbackResultV1;
    }>);

export class NodeTaskCallbackProtocolV1Error extends Data.TaggedError(
  "NodeTaskCallbackProtocolV1Error",
)<{
  readonly boundary: "request" | "response";
  readonly reason:
    | "invalid_shape"
    | "invalid_credential"
    | "invalid_key"
    | "invalid_payload"
    | "correlation_mismatch";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

const MAX_POSITIVE_INT64 = (1n << 63n) - 1n;
const VISIBLE_ASCII = /^[\x21-\x7e]{1,1024}$/u;
const START_KEY_PREFIX = "flarex.node-task-executor/start-key/v1/";
const REQUEST_ID_PREFIX = "flarex.node-task-callback/request-id/v1/";
const decodeExecutionId = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeExecutionIdV1Schema),
  { onExcessProperty: "error" },
);

export function makeNodeTaskCallbackRequestIdV1(
  capabilityId: string,
  sequence: NodeTaskCallbackSequenceV1,
): NodeTaskCallbackRequestIdV1 {
  return `${REQUEST_ID_PREFIX}${encodeURIComponent(capabilityId)}/${
    sequence.toString(10)
  }` as NodeTaskCallbackRequestIdV1;
}

export function decodeNodeTaskCallbackSequenceV1(
  input: unknown,
): Result.Result<NodeTaskCallbackSequenceV1, NodeTaskCallbackProtocolV1Error> {
  return isPositiveInt64(input)
    ? Result.succeed(input as NodeTaskCallbackSequenceV1)
    : Result.fail(protocolFailure("request", "invalid_shape", "sequence"));
}

export function decodeNodeTaskCallbackAttachmentV1(
  input: unknown,
): Result.Result<NodeTaskCallbackAttachmentV1, NodeTaskCallbackProtocolV1Error> {
  const record = captureExactRecord(input, [
    "format", "version", "capabilityId", "credential", "startKey",
    "sessionId", "executionId", "expiresAtEpochMilliseconds",
  ]);
  if (
    record === undefined ||
    record.format !== NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1 ||
    record.version !== NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1 ||
    !isVisibleAscii(record.capabilityId) || !isStartKey(record.startKey) ||
    !isVisibleAscii(record.sessionId) ||
    !Number.isSafeInteger(record.expiresAtEpochMilliseconds) ||
    (record.expiresAtEpochMilliseconds as number) <= 0
  ) return Result.fail(protocolFailure("request", "invalid_shape"));
  const credential = captureNodeTaskCallbackCredentialV1(record.credential);
  if (credential === undefined) {
    return Result.fail(protocolFailure(
      "request", "invalid_credential", "credential",
    ));
  }
  return decodeExecutionId(record.executionId).pipe(
    Result.mapError(cause => protocolFailure(
      "request", "invalid_shape", "executionId", cause,
    )),
    Result.map(executionId => Object.freeze({
      format: NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
      version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
      capabilityId: record.capabilityId as string,
      credential,
      startKey: record.startKey as NodeTaskExecutorStartKeyV1,
      sessionId: record.sessionId as NodeTaskExecutorSessionIdV1,
      executionId,
      expiresAtEpochMilliseconds: record.expiresAtEpochMilliseconds as number,
    })),
  );
}

export function decodeNodeTaskCallbackAttachmentAckV1(
  input: unknown,
): Result.Result<
  NodeTaskCallbackAttachmentAckV1,
  NodeTaskCallbackProtocolV1Error
> {
  const record = captureExactRecord(input, [
    "format", "version", "kind", "capabilityId", "startKey", "sessionId",
    "executionId", "expiresAtEpochMilliseconds",
  ]);
  if (
    record === undefined ||
    record.format !== NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1 ||
    record.version !== NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1 ||
    record.kind !== "attached" || !isVisibleAscii(record.capabilityId) ||
    !isStartKey(record.startKey) || !isVisibleAscii(record.sessionId) ||
    !Number.isSafeInteger(record.expiresAtEpochMilliseconds) ||
    (record.expiresAtEpochMilliseconds as number) <= 0
  ) return Result.fail(protocolFailure("response", "invalid_shape"));
  return decodeExecutionId(record.executionId).pipe(
    Result.mapError(cause => protocolFailure(
      "response", "invalid_shape", "executionId", cause,
    )),
    Result.map(executionId => Object.freeze({
      format: NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
      version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
      kind: "attached" as const,
      capabilityId: record.capabilityId as string,
      startKey: record.startKey as NodeTaskExecutorStartKeyV1,
      sessionId: record.sessionId as NodeTaskExecutorSessionIdV1,
      executionId,
      expiresAtEpochMilliseconds: record.expiresAtEpochMilliseconds as number,
    })),
  );
}

export function decodeNodeTaskCallbackAttachmentAckForRequestV1(
  responseInput: unknown,
  requestInput: unknown,
): Result.Result<
  NodeTaskCallbackAttachmentAckV1,
  NodeTaskCallbackProtocolV1Error
> {
  return Result.gen(function* () {
    const request = yield* decodeNodeTaskCallbackAttachmentV1(requestInput);
    const response = yield* decodeNodeTaskCallbackAttachmentAckV1(responseInput);
    return response.capabilityId === request.capabilityId &&
        response.startKey === request.startKey &&
        response.sessionId === request.sessionId &&
        response.executionId === request.executionId &&
        response.expiresAtEpochMilliseconds === request.expiresAtEpochMilliseconds
      ? response
      : yield* Result.fail(protocolFailure(
          "response", "correlation_mismatch",
        ));
  });
}

export function decodeNodeTaskCallbackRequestV1(
  input: unknown,
): Result.Result<NodeTaskCallbackRequestV1, NodeTaskCallbackProtocolV1Error> {
  const record = captureExactRecord(input, [
    "format", "version", "capabilityId", "credential", "startKey",
    "sessionId", "executionId", "sequence", "requestId", "operation",
    "payload",
  ]);
  if (
    record === undefined ||
    record.format !== NODE_TASK_CALLBACK_REQUEST_FORMAT_V1 ||
    record.version !== NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1 ||
    !isVisibleAscii(record.capabilityId) || !isStartKey(record.startKey) ||
    !isVisibleAscii(record.sessionId) || !isPositiveInt64(record.sequence)
  ) return Result.fail(protocolFailure("request", "invalid_shape"));
  const credential = captureNodeTaskCallbackCredentialV1(record.credential);
  if (credential === undefined) {
    return Result.fail(protocolFailure(
      "request", "invalid_credential", "credential",
    ));
  }
  return Result.gen(function* () {
    const executionId = yield* decodeExecutionId(record.executionId).pipe(
      Result.mapError(cause => protocolFailure(
        "request", "invalid_shape", "executionId", cause,
      )),
    );
    const sequence = record.sequence as NodeTaskCallbackSequenceV1;
    const requestId = makeNodeTaskCallbackRequestIdV1(
      record.capabilityId as string,
      sequence,
    );
    if (record.requestId !== requestId) {
      return yield* Result.fail(protocolFailure(
        "request", "invalid_key", "requestId",
      ));
    }
    const common = Object.freeze({
      format: NODE_TASK_CALLBACK_REQUEST_FORMAT_V1,
      version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
      capabilityId: record.capabilityId as string,
      credential,
      startKey: record.startKey as NodeTaskExecutorStartKeyV1,
      sessionId: record.sessionId as NodeTaskExecutorSessionIdV1,
      executionId,
      sequence,
      requestId,
    });
    if (record.operation === "runQuery") {
      const payload = yield* decodeApplicationTaskQueryCallbackRequestV1(
        record.payload,
      ).pipe(Result.mapError(cause => protocolFailure(
        "request", "invalid_payload", "payload", cause,
      )));
      return Object.freeze({ ...common, operation: "runQuery" as const, payload });
    }
    if (record.operation === "runMutation") {
      const payload = yield* decodeApplicationTaskMutationCallbackRequestV1(
        record.payload,
      ).pipe(Result.mapError(cause => protocolFailure(
        "request", "invalid_payload", "payload", cause,
      )));
      return Object.freeze({
        ...common,
        operation: "runMutation" as const,
        payload,
      });
    }
    return yield* Result.fail(protocolFailure(
      "request", "invalid_shape", "operation",
    ));
  });
}

export function decodeNodeTaskCallbackResponseV1(
  input: unknown,
): Result.Result<NodeTaskCallbackResponseV1, NodeTaskCallbackProtocolV1Error> {
  const record = captureExactRecord(input, [
    "format", "version", "capabilityId", "startKey", "sessionId",
    "executionId", "sequence", "requestId", "operation", "result",
  ]);
  if (
    record === undefined ||
    record.format !== NODE_TASK_CALLBACK_RESPONSE_FORMAT_V1 ||
    record.version !== NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1 ||
    !isVisibleAscii(record.capabilityId) || !isStartKey(record.startKey) ||
    !isVisibleAscii(record.sessionId) || !isPositiveInt64(record.sequence)
  ) return Result.fail(protocolFailure("response", "invalid_shape"));
  return Result.gen(function* () {
    const executionId = yield* decodeExecutionId(record.executionId).pipe(
      Result.mapError(cause => protocolFailure(
        "response", "invalid_shape", "executionId", cause,
      )),
    );
    const sequence = record.sequence as NodeTaskCallbackSequenceV1;
    const requestId = makeNodeTaskCallbackRequestIdV1(
      record.capabilityId as string,
      sequence,
    );
    if (record.requestId !== requestId) {
      return yield* Result.fail(protocolFailure(
        "response", "invalid_key", "requestId",
      ));
    }
    const common = Object.freeze({
      format: NODE_TASK_CALLBACK_RESPONSE_FORMAT_V1,
      version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
      capabilityId: record.capabilityId as string,
      startKey: record.startKey as NodeTaskExecutorStartKeyV1,
      sessionId: record.sessionId as NodeTaskExecutorSessionIdV1,
      executionId,
      sequence,
      requestId,
    });
    if (record.operation === "runQuery") {
      const result = yield* decodeApplicationTaskQueryCallbackResultV1(
        record.result,
      ).pipe(Result.mapError(cause => protocolFailure(
        "response", "invalid_payload", "result", cause,
      )));
      return Object.freeze({ ...common, operation: "runQuery" as const, result });
    }
    if (record.operation === "runMutation") {
      const result = yield* decodeApplicationTaskMutationCallbackResultV1(
        record.result,
      ).pipe(Result.mapError(cause => protocolFailure(
        "response", "invalid_payload", "result", cause,
      )));
      return Object.freeze({
        ...common,
        operation: "runMutation" as const,
        result,
      });
    }
    return yield* Result.fail(protocolFailure(
      "response", "invalid_shape", "operation",
    ));
  });
}

export function decodeNodeTaskCallbackResponseForRequestV1(
  responseInput: unknown,
  requestInput: unknown,
): Result.Result<NodeTaskCallbackResponseV1, NodeTaskCallbackProtocolV1Error> {
  return Result.gen(function* () {
    const request = yield* decodeNodeTaskCallbackRequestV1(requestInput);
    const response = yield* decodeNodeTaskCallbackResponseV1(responseInput);
    const correlated = response.capabilityId === request.capabilityId &&
      response.startKey === request.startKey &&
      response.sessionId === request.sessionId &&
      response.executionId === request.executionId &&
      response.sequence === request.sequence &&
      response.requestId === request.requestId &&
      response.operation === request.operation;
    if (!correlated) {
      return yield* Result.fail(protocolFailure(
        "response", "correlation_mismatch",
      ));
    }
    if (request.operation === "runMutation" &&
      response.operation === "runMutation" &&
      response.result.callId !==
        `${request.executionId}:mutation:${request.payload.ordinal}`) {
      return yield* Result.fail(protocolFailure(
        "response", "correlation_mismatch", "result.callId",
      ));
    }
    if (request.operation === "runQuery" &&
      response.operation === "runQuery" &&
      !response.result.callId.startsWith(`${request.executionId}:query:`)) {
      return yield* Result.fail(protocolFailure(
        "response", "correlation_mismatch", "result.callId",
      ));
    }
    return response;
  });
}

export function captureNodeTaskCallbackCredentialV1(
  input: unknown,
): NodeTaskCallbackCredentialV1 | undefined {
  if (!isUint8ArrayWithByteLength(
    input,
    NODE_TASK_CALLBACK_CREDENTIAL_BYTES_V1,
  )) return undefined;
  try {
    return copyBytes(input) as NodeTaskCallbackCredentialV1;
  } catch {
    return undefined;
  }
}

function captureExactRecord(
  input: unknown,
  keys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== keys.length || ownKeys.some(
      key => typeof key !== "string" || !keys.includes(key),
    )) return undefined;
    const captured: Record<string, unknown> = {};
    for (const key of keys) captured[key] = input[key];
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function isVisibleAscii(input: unknown): input is string {
  return typeof input === "string" && VISIBLE_ASCII.test(input);
}

function isStartKey(input: unknown): input is NodeTaskExecutorStartKeyV1 {
  return isVisibleAscii(input) && input.startsWith(START_KEY_PREFIX);
}

function isPositiveInt64(input: unknown): input is bigint {
  return typeof input === "bigint" && input > 0n && input <= MAX_POSITIVE_INT64;
}

function protocolFailure(
  boundary: NodeTaskCallbackProtocolV1Error["boundary"],
  reason: NodeTaskCallbackProtocolV1Error["reason"],
  path?: string,
  cause?: unknown,
): NodeTaskCallbackProtocolV1Error {
  return new NodeTaskCallbackProtocolV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
