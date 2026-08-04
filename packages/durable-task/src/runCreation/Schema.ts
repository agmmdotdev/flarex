import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { Result, Schema } from "effect";

import {
  TaskDatabaseTimeMsV1Schema,
  TaskDefinitionRevisionIdV1Schema,
  TaskRunIdV1Schema,
} from "../runAttempt/Schema.js";
import { InvalidTaskRunCreationRequestError } from "./Errors.js";
import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  MAX_TASK_RUN_CREATION_REQUEST_KEY_UTF8_BYTES_V1,
  TASK_INPUT_OBJECT_KEY_PREFIX_V1,
  TASK_INPUT_OBJECT_STORE_V1,
  TASK_INPUT_REFERENCE_CODEC_V1,
  TASK_INPUT_RETENTION_V1,
  TASK_INPUT_VALUE_CODEC_V1,
  type TaskInputReferenceV1,
  type TaskInputSha256V1,
  type TaskRunCreationAuthoritySha256V1,
  type TaskRunCreationReceiptV1,
  type TaskRunCreationRequestKeySha256V1,
  type TaskRunCreationRequestKeyV1,
  type TaskRunCreationRequestSha256V1,
  type TaskRunCreationRequestV1,
} from "./Model.js";

const STRICT_STRUCT_OPTIONS = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const UTF8 = new TextEncoder();

function validOpaqueKey(value: string): boolean {
  if (
    value.length === 0 ||
    UTF8.encode(value).byteLength >
      MAX_TASK_RUN_CREATION_REQUEST_KEY_UTF8_BYTES_V1 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value) ||
    value.trimStart() !== value ||
    value.trimEnd() !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const TaskRunCreationRequestKeyV1Schema = Schema.String.check(
  Schema.makeFilter((value) => validOpaqueKey(value)
    ? undefined
    : "Expected a bounded opaque task-run creation request key"),
).pipe(Schema.brand("FlarexDurableTask/TaskRunCreationRequestKeyV1"));

const Sha256BytesSchema = Schema.Uint8Array.check(
  Schema.makeFilter((value) => value.byteLength === 32
    ? undefined
    : "Expected a 32-byte SHA-256 digest"),
);

const TaskInputSha256V1Schema = Sha256BytesSchema.pipe(
  Schema.brand("FlarexDurableTask/TaskInputSha256V1"),
);
const TaskRunCreationRequestKeySha256V1Schema = Sha256BytesSchema.pipe(
  Schema.brand("FlarexDurableTask/TaskRunCreationRequestKeySha256V1"),
);
const TaskRunCreationRequestSha256V1Schema = Sha256BytesSchema.pipe(
  Schema.brand("FlarexDurableTask/TaskRunCreationRequestSha256V1"),
);
const TaskRunCreationAuthoritySha256V1Schema = Sha256BytesSchema.pipe(
  Schema.brand("FlarexDurableTask/TaskRunCreationAuthoritySha256V1"),
);

const TaskInputReferenceShapeV1Schema = Schema.Struct({
  codec: Schema.Literal(TASK_INPUT_REFERENCE_CODEC_V1),
  store: Schema.Literal(TASK_INPUT_OBJECT_STORE_V1),
  valueCodec: Schema.Literal(TASK_INPUT_VALUE_CODEC_V1),
  objectKey: Schema.String,
  byteLength: Schema.Number.check(
    Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 1 &&
        value <= MAX_TASK_INPUT_CANONICAL_BYTES_V1
      ? undefined
      : "Expected a positive task input byte length within the V1 ceiling"),
  ),
  sha256: TaskInputSha256V1Schema,
  retention: Schema.Struct({
    kind: Schema.Literal(TASK_INPUT_RETENTION_V1),
  }).annotate(STRICT_STRUCT_OPTIONS),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((reference) =>
    reference.objectKey === taskInputObjectKeyV1(reference.sha256)
      ? undefined
      : "Expected the task input object key derived from its SHA-256 digest"
  ),
);

const TaskInputReferenceV1Schema = TaskInputReferenceShapeV1Schema;

const TaskRunCreationRequestShapeV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  requestKey: TaskRunCreationRequestKeyV1Schema,
  taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
  input: TaskInputReferenceV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

const TaskRunCreationRequestV1Schema =
  TaskRunCreationRequestShapeV1Schema;

const TaskRunCreationReceiptShapeV1Schema = Schema.Struct({
  status: Schema.Literal("created"),
  version: Schema.Literal(1),
  runId: TaskRunIdV1Schema,
  taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
  createdAtMs: TaskDatabaseTimeMsV1Schema,
  requestKeySha256: TaskRunCreationRequestKeySha256V1Schema,
  requestSha256: TaskRunCreationRequestSha256V1Schema,
  creationAuthoritySha256: TaskRunCreationAuthoritySha256V1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

const TaskRunCreationReceiptV1Schema =
  TaskRunCreationReceiptShapeV1Schema;

const decodeRequestKey = Schema.decodeUnknownResult(
  TaskRunCreationRequestKeyV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeInputReference = Schema.decodeUnknownResult(
  TaskInputReferenceV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeRequest = Schema.decodeUnknownResult(
  TaskRunCreationRequestV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeReceipt = Schema.decodeUnknownResult(
  TaskRunCreationReceiptV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeInputDigest = Schema.decodeUnknownResult(
  TaskInputSha256V1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeDefinitionRevisionId = Schema.decodeUnknownResult(
  TaskDefinitionRevisionIdV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeRunId = Schema.decodeUnknownResult(
  TaskRunIdV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeDatabaseTime = Schema.decodeUnknownResult(
  TaskDatabaseTimeMsV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeRequestKeyDigest = Schema.decodeUnknownResult(
  TaskRunCreationRequestKeySha256V1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeRequestDigest = Schema.decodeUnknownResult(
  TaskRunCreationRequestSha256V1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeCreationAuthorityDigest = Schema.decodeUnknownResult(
  TaskRunCreationAuthoritySha256V1Schema,
  STRICT_PARSE_OPTIONS,
);

export function taskInputObjectKeyV1(sha256: TaskInputSha256V1): string {
  return `${TASK_INPUT_OBJECT_KEY_PREFIX_V1}${
    encodeBytesToLowercaseHex(sha256)
  }`;
}

export function decodeTaskRunCreationRequestKeyV1(
  input: unknown,
): Result.Result<
  TaskRunCreationRequestKeyV1,
  InvalidTaskRunCreationRequestError
> {
  return decodeRequestKey(input).pipe(
    Result.mapError(() => invalid("decode_request_key", "invalid_request_key")),
  );
}

export function makeTaskInputReferenceV1(
  sha256: unknown,
  byteLength: unknown,
): Result.Result<TaskInputReferenceV1, InvalidTaskRunCreationRequestError> {
  const capturedDigest = captureSha256(sha256);
  if (capturedDigest === undefined) {
    return Result.fail(invalid("make_input_reference", "invalid_digest"));
  }
  return Result.gen(function* () {
    const decodedDigest = yield* decodeInputDigest(capturedDigest).pipe(
      Result.mapError(() => invalid("make_input_reference", "invalid_digest")),
    );
    return yield* decodeTaskInputReferenceV1({
      codec: TASK_INPUT_REFERENCE_CODEC_V1,
      store: TASK_INPUT_OBJECT_STORE_V1,
      valueCodec: TASK_INPUT_VALUE_CODEC_V1,
      objectKey: taskInputObjectKeyV1(decodedDigest),
      byteLength,
      sha256: decodedDigest,
      retention: { kind: TASK_INPUT_RETENTION_V1 },
    }).pipe(
      Result.mapError(() =>
        invalid("make_input_reference", "invalid_input_reference")
      ),
    );
  });
}

export function decodeTaskInputReferenceV1(
  input: unknown,
): Result.Result<TaskInputReferenceV1, InvalidTaskRunCreationRequestError> {
  const candidate = captureTaskInputReferenceCandidateV1(input);
  if (candidate === undefined) {
    return Result.fail(
      invalid("decode_input_reference", "invalid_input_reference"),
    );
  }
  return decodeInputReference(candidate).pipe(
    Result.map(snapshotTaskInputReferenceV1),
    Result.mapError(() =>
      invalid("decode_input_reference", "invalid_input_reference"),
    ),
  );
}

export function decodeTaskRunCreationRequestV1(
  input: unknown,
): Result.Result<TaskRunCreationRequestV1, InvalidTaskRunCreationRequestError> {
  const outer = captureExactDataRecord(input, [
    "version",
    "requestKey",
    "taskDefinitionRevisionId",
    "input",
  ]);
  if (outer === undefined) {
    return Result.fail(invalid("decode_request", "invalid_shape"));
  }
  if (outer.version !== 1) {
    return Result.fail(invalid("decode_request", "invalid_shape"));
  }
  if (Result.isFailure(decodeRequestKey(outer.requestKey))) {
    return Result.fail(invalid("decode_request", "invalid_request_key"));
  }
  if (Result.isFailure(decodeDefinitionRevisionId(
    outer.taskDefinitionRevisionId,
  ))) {
    return Result.fail(
      invalid("decode_request", "invalid_definition_revision"),
    );
  }
  const capturedInput = captureTaskInputReferenceCandidateV1(outer.input);
  if (capturedInput === undefined) {
    return Result.fail(invalid("decode_request", "invalid_input_reference"));
  }
  const candidate = {
    version: outer.version,
    requestKey: outer.requestKey,
    taskDefinitionRevisionId: outer.taskDefinitionRevisionId,
    input: capturedInput,
  };
  return decodeRequest(candidate).pipe(
    Result.map(snapshotTaskRunCreationRequestV1),
    Result.mapError(() => invalid("decode_request", requestIssue(candidate))),
  );
}

export function decodeTaskRunCreationReceiptV1(
  input: unknown,
): Result.Result<TaskRunCreationReceiptV1, InvalidTaskRunCreationRequestError> {
  const outer = captureExactDataRecord(input, [
    "status",
    "version",
    "runId",
    "taskDefinitionRevisionId",
    "createdAtMs",
    "requestKeySha256",
    "requestSha256",
    "creationAuthoritySha256",
  ]);
  if (outer === undefined) {
    return Result.fail(invalid("decode_receipt", "invalid_shape"));
  }
  if (outer.status !== "created" || outer.version !== 1) {
    return Result.fail(invalid("decode_receipt", "invalid_shape"));
  }
  if (Result.isFailure(decodeRunId(outer.runId))) {
    return Result.fail(invalid("decode_receipt", "invalid_run_id"));
  }
  if (Result.isFailure(decodeDefinitionRevisionId(
    outer.taskDefinitionRevisionId,
  ))) {
    return Result.fail(
      invalid("decode_receipt", "invalid_definition_revision"),
    );
  }
  if (Result.isFailure(decodeDatabaseTime(outer.createdAtMs))) {
    return Result.fail(invalid("decode_receipt", "invalid_database_time"));
  }
  const requestKeySha256 = captureSha256(outer.requestKeySha256);
  const requestSha256 = captureSha256(outer.requestSha256);
  const creationAuthoritySha256 = captureSha256(outer.creationAuthoritySha256);
  if (
    requestKeySha256 === undefined ||
    requestSha256 === undefined ||
    creationAuthoritySha256 === undefined
  ) {
    return Result.fail(invalid("decode_receipt", "invalid_digest"));
  }
  const candidate = {
    status: outer.status,
    version: outer.version,
    runId: outer.runId,
    taskDefinitionRevisionId: outer.taskDefinitionRevisionId,
    createdAtMs: outer.createdAtMs,
    requestKeySha256,
    requestSha256,
    creationAuthoritySha256,
  };
  return decodeReceipt(candidate).pipe(
    Result.map(snapshotTaskRunCreationReceiptV1),
    Result.mapError(() => invalid("decode_receipt", receiptIssue(candidate))),
  );
}

function captureTaskInputReferenceCandidateV1(
  input: unknown,
): Readonly<Record<string, unknown>> | undefined {
  const outer = captureExactDataRecord(input, [
    "codec",
    "store",
    "valueCodec",
    "objectKey",
    "byteLength",
    "sha256",
    "retention",
  ]);
  if (outer === undefined) return undefined;
  const retention = captureExactDataRecord(outer.retention, ["kind"]);
  const sha256 = captureSha256(outer.sha256);
  if (retention === undefined || sha256 === undefined) return undefined;
  return {
    codec: outer.codec,
    store: outer.store,
    valueCodec: outer.valueCodec,
    objectKey: outer.objectKey,
    byteLength: outer.byteLength,
    sha256,
    retention: { kind: retention.kind },
  };
}

function captureSha256(input: unknown): Uint8Array | undefined {
  return isUint8ArrayWithByteLength(input, 32) ? copyBytes(input) : undefined;
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
      keys.length !== expectedKeys.length ||
      keys.some((key) =>
        typeof key !== "string" || !expectedKeys.includes(key)
      )
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
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

function snapshotTaskInputReferenceV1(
  reference: typeof TaskInputReferenceShapeV1Schema.Type,
): TaskInputReferenceV1 {
  return Object.freeze({
    ...reference,
    sha256: copyBytes(reference.sha256) as TaskInputSha256V1,
    retention: Object.freeze({ ...reference.retention }),
  });
}

function snapshotTaskRunCreationRequestV1(
  request: typeof TaskRunCreationRequestShapeV1Schema.Type,
): TaskRunCreationRequestV1 {
  return Object.freeze({
    ...request,
    input: snapshotTaskInputReferenceV1(request.input),
  });
}

function snapshotTaskRunCreationReceiptV1(
  receipt: typeof TaskRunCreationReceiptShapeV1Schema.Type,
): TaskRunCreationReceiptV1 {
  return Object.freeze({
    ...receipt,
    requestKeySha256:
      copyBytes(receipt.requestKeySha256) as TaskRunCreationRequestKeySha256V1,
    requestSha256:
      copyBytes(receipt.requestSha256) as TaskRunCreationRequestSha256V1,
    creationAuthoritySha256:
      copyBytes(receipt.creationAuthoritySha256) as TaskRunCreationAuthoritySha256V1,
  });
}

function requestIssue(
  input: unknown,
): InvalidTaskRunCreationRequestError["reason"] {
  if (!isRecord(input) || input.version !== 1) return "invalid_shape";
  if (Result.isFailure(decodeRequestKey(input.requestKey))) {
    return "invalid_request_key";
  }
  if (Result.isFailure(decodeDefinitionRevisionId(
    input.taskDefinitionRevisionId,
  ))) {
    return "invalid_definition_revision";
  }
  if (Result.isFailure(decodeInputReference(input.input))) {
    return "invalid_input_reference";
  }
  return "invalid_shape";
}

function receiptIssue(
  input: unknown,
): InvalidTaskRunCreationRequestError["reason"] {
  if (!isRecord(input) || input.status !== "created" || input.version !== 1) {
    return "invalid_shape";
  }
  if (Result.isFailure(decodeRunId(input.runId))) {
    return "invalid_run_id";
  }
  if (Result.isFailure(decodeDefinitionRevisionId(
    input.taskDefinitionRevisionId,
  ))) {
    return "invalid_definition_revision";
  }
  if (Result.isFailure(decodeDatabaseTime(input.createdAtMs))) {
    return "invalid_database_time";
  }
  if (
    Result.isFailure(decodeRequestKeyDigest(input.requestKeySha256)) ||
    Result.isFailure(decodeRequestDigest(input.requestSha256)) ||
    Result.isFailure(decodeCreationAuthorityDigest(
      input.creationAuthoritySha256,
    ))
  ) {
    return "invalid_digest";
  }
  return "invalid_shape";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  operation: InvalidTaskRunCreationRequestError["operation"],
  reason: InvalidTaskRunCreationRequestError["reason"],
): InvalidTaskRunCreationRequestError {
  return new InvalidTaskRunCreationRequestError({ operation, reason });
}
