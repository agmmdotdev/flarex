import { Brand, Result } from "effect";

import {
  decodeTaskDatabaseTimeMsV1,
  decodeTaskRunIdV1,
} from "../runAttempt/Schema.js";
import type {
  TaskRequestedEffectPersistenceCursorV1,
} from "../runAttempt/PersistenceProjection.js";
import { InvalidTaskSystemRunReadRequestError } from "./Errors.js";
import {
  MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1,
  type TaskDueDiscoveryCursorV1,
  type TaskDueDiscoveryRequestV1,
  type TaskRequestedEffectPageCursorV1,
  type TaskRequestedEffectPageRequestV1,
  type TaskSystemReadPageSizeV1,
} from "./Model.js";

const readPageSize = Brand.nominal<TaskSystemReadPageSizeV1>();
const effectCursor = Brand.nominal<TaskRequestedEffectPersistenceCursorV1>();
const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function decodeTaskDueDiscoveryRequestV1(
  input: unknown,
): Result.Result<
  TaskDueDiscoveryRequestV1,
  InvalidTaskSystemRunReadRequestError<"decode_due_discovery_request">
> {
  const operation = "decode_due_discovery_request" as const;
  const request = captureExactDataRecord(input, [
    "version",
    "dueKind",
    "pageSize",
    "cursor",
  ]);
  if (
    request === undefined || request.version !== 1
    || !isDueKind(request.dueKind)
  ) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  const dueKind = request.dueKind;
  return Result.gen(function* () {
    const pageSize = yield* decodePageSize(request.pageSize, operation);
    const cursor = request.cursor === null
      ? null
      : yield* decodeDueCursor(request.cursor, operation);
    if (cursor !== null && cursor.dueKind !== dueKind) {
      return yield* Result.fail(invalid(operation, "invalid_cursor"));
    }
    return Object.freeze({
      version: 1,
      dueKind,
      pageSize,
      cursor,
    });
  });
}

export function decodeTaskRequestedEffectPageRequestV1(
  input: unknown,
): Result.Result<
  TaskRequestedEffectPageRequestV1,
  InvalidTaskSystemRunReadRequestError<"decode_requested_effect_page_request">
> {
  const operation = "decode_requested_effect_page_request" as const;
  const request = captureExactDataRecord(input, [
    "version",
    "runId",
    "pageSize",
    "cursor",
  ]);
  if (request === undefined || request.version !== 1) {
    return Result.fail(invalid(operation, "invalid_shape"));
  }
  return Result.gen(function* () {
    const runId = yield* decodeTaskRunIdV1(request.runId).pipe(
      Result.mapError(() => invalid(operation, "invalid_identifier")),
    );
    const pageSize = yield* decodePageSize(request.pageSize, operation);
    const cursor = request.cursor === null
      ? null
      : yield* decodeEffectCursor(request.cursor, operation);
    if (cursor !== null && cursor.runId !== runId) {
      return yield* Result.fail(invalid(operation, "invalid_cursor"));
    }
    return Object.freeze({ version: 1, runId, pageSize, cursor });
  });
}

function decodePageSize<
  Operation extends InvalidTaskSystemRunReadRequestError["operation"],
>(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskSystemReadPageSizeV1,
  InvalidTaskSystemRunReadRequestError<Operation>
> {
  return typeof input === "number"
      && Number.isSafeInteger(input)
      && input >= 1
      && input <= MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1
    ? Result.succeed(readPageSize(input))
    : Result.fail(invalid(operation, "invalid_number"));
}

function decodeDueCursor(
  input: unknown,
  operation: "decode_due_discovery_request",
): Result.Result<
  TaskDueDiscoveryCursorV1,
  InvalidTaskSystemRunReadRequestError<"decode_due_discovery_request">
> {
  const cursor = captureExactDataRecord(input, [
    "version",
    "dueKind",
    "throughMs",
    "dueAtMs",
    "runId",
  ]);
  if (
    cursor === undefined || cursor.version !== 1
    || !isDueKind(cursor.dueKind)
  ) {
    return Result.fail(invalid(operation, "invalid_cursor"));
  }
  const dueKind = cursor.dueKind;
  return Result.gen(function* () {
    const throughMs = yield* decodeTaskDatabaseTimeMsV1(cursor.throughMs).pipe(
      Result.mapError(() => invalid(operation, "invalid_cursor")),
    );
    const dueAtMs = yield* decodeTaskDatabaseTimeMsV1(cursor.dueAtMs).pipe(
      Result.mapError(() => invalid(operation, "invalid_cursor")),
    );
    const runId = yield* decodeTaskRunIdV1(cursor.runId).pipe(
      Result.mapError(() => invalid(operation, "invalid_cursor")),
    );
    if (dueAtMs > throughMs) {
      return yield* Result.fail(invalid(operation, "invalid_cursor"));
    }
    return Object.freeze({
      version: 1,
      dueKind,
      throughMs,
      dueAtMs,
      runId,
    });
  });
}

function decodeEffectCursor(
  input: unknown,
  operation: "decode_requested_effect_page_request",
): Result.Result<
  TaskRequestedEffectPageCursorV1,
  InvalidTaskSystemRunReadRequestError<"decode_requested_effect_page_request">
> {
  const cursor = captureExactDataRecord(input, [
    "version",
    "runId",
    "throughSequence",
    "afterSequence",
  ]);
  if (cursor === undefined || cursor.version !== 1) {
    return Result.fail(invalid(operation, "invalid_cursor"));
  }
  return Result.gen(function* () {
    const runId = yield* decodeTaskRunIdV1(cursor.runId).pipe(
      Result.mapError(() => invalid(operation, "invalid_cursor")),
    );
    const throughSequence = yield* decodeEffectCursorSequence(
      cursor.throughSequence,
      operation,
    );
    const afterSequence = yield* decodeEffectCursorSequence(
      cursor.afterSequence,
      operation,
    );
    if (afterSequence > throughSequence) {
      return yield* Result.fail(invalid(operation, "invalid_cursor"));
    }
    return Object.freeze({
      version: 1,
      runId,
      throughSequence,
      afterSequence,
    });
  });
}

function decodeEffectCursorSequence(
  input: unknown,
  operation: "decode_requested_effect_page_request",
): Result.Result<
  TaskRequestedEffectPersistenceCursorV1,
  InvalidTaskSystemRunReadRequestError<"decode_requested_effect_page_request">
> {
  return typeof input === "bigint"
      && input >= 0n
      && input <= POSTGRES_SIGNED_BIGINT_MAX
    ? Result.succeed(effectCursor(input))
    : Result.fail(invalid(operation, "invalid_cursor"));
}

function isDueKind(input: unknown): input is TaskDueDiscoveryRequestV1["dueKind"] {
  return input === "start_attempt" || input === "handle_lease_expiry";
}

function invalid<
  Operation extends InvalidTaskSystemRunReadRequestError["operation"],
>(
  operation: Operation,
  issue: InvalidTaskSystemRunReadRequestError["issue"],
): InvalidTaskSystemRunReadRequestError<Operation> {
  return new InvalidTaskSystemRunReadRequestError<Operation>({
    operation,
    issue,
  });
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== expectedKeys.length
      || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return undefined;
  }
}
